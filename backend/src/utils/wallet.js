/**
 * @fileoverview Wallet balance mutations — atomic credits and debits.
 * Purpose: Single place for balance checks, ledger rows, and Stripe idempotency.
 * Downstream: wallet routes, agent create, admin credits.
 */

import mongoose from "mongoose";
import { User } from "../models/User.js";
import { WalletTransaction } from "../models/WalletTransaction.js";

/**
 * @param {string} userId
 * @returns {Promise<number>}
 */
export async function getWalletBalanceCents(userId) {
  const user = await User.findById(userId).select("walletBalanceCents").lean();
  return Math.max(0, Number(user?.walletBalanceCents) || 0);
}

/**
 * @param {string} userId
 * @returns {Promise<{ balanceCents: number, balanceUsd: number }>}
 */
export async function getWalletSummary(userId) {
  const balanceCents = await getWalletBalanceCents(userId);
  return {
    balanceCents,
    balanceUsd: Number((balanceCents / 100).toFixed(2)),
  };
}

/**
 * @param {{
 *   userId: string,
 *   amountCents: number,
 *   type: string,
 *   note?: string,
 *   stripeSessionId?: string|null,
 *   stripePaymentIntentId?: string|null,
 *   agentId?: string|null,
 *   adminUserId?: string|null,
 *   meta?: object,
 * }} opts
 */
export async function creditWallet(opts) {
  const amountCents = Math.round(Number(opts.amountCents) || 0);
  if (amountCents <= 0) {
    const err = new Error("Credit amount must be positive");
    err.status = 400;
    throw err;
  }

  if (opts.stripeSessionId) {
    const existing = await WalletTransaction.findOne({
      stripeSessionId: opts.stripeSessionId,
    }).lean();
    if (existing) {
      return {
        duplicate: true,
        balanceCents: existing.balanceAfterCents,
        transaction: existing,
      };
    }
  }

  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    const user = await User.findById(opts.userId).session(session);
    if (!user) {
      const err = new Error("User missing");
      err.status = 404;
      throw err;
    }
    user.walletBalanceCents = Math.max(0, Number(user.walletBalanceCents) || 0) + amountCents;
    await user.save({ session });

    const [tx] = await WalletTransaction.create(
      [
        {
          user: user._id,
          type: opts.type,
          amountCents,
          balanceAfterCents: user.walletBalanceCents,
          note: opts.note || "",
          stripeSessionId: opts.stripeSessionId || null,
          stripePaymentIntentId: opts.stripePaymentIntentId || null,
          agent: opts.agentId || null,
          adminUser: opts.adminUserId || null,
          meta: opts.meta || {},
        },
      ],
      { session }
    );

    await session.commitTransaction();
    return {
      duplicate: false,
      balanceCents: user.walletBalanceCents,
      transaction: tx,
    };
  } catch (err) {
    await session.abortTransaction();
    if (err?.code === 11000 && opts.stripeSessionId) {
      const existing = await WalletTransaction.findOne({
        stripeSessionId: opts.stripeSessionId,
      }).lean();
      if (existing) {
        return {
          duplicate: true,
          balanceCents: existing.balanceAfterCents,
          transaction: existing,
        };
      }
    }
    throw err;
  } finally {
    session.endSession();
  }
}

/**
 * @param {{
 *   userId: string,
 *   amountCents: number,
 *   type: string,
 *   note?: string,
 *   agentId?: string|null,
 *   meta?: object,
 * }} opts
 */
export async function debitWallet(opts) {
  const amountCents = Math.round(Number(opts.amountCents) || 0);
  if (amountCents <= 0) {
    const err = new Error("Debit amount must be positive");
    err.status = 400;
    throw err;
  }

  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    const user = await User.findById(opts.userId).session(session);
    if (!user) {
      const err = new Error("User missing");
      err.status = 404;
      throw err;
    }
    const balance = Math.max(0, Number(user.walletBalanceCents) || 0);
    if (balance < amountCents) {
      const err = new Error("Insufficient wallet balance");
      err.status = 402;
      err.title = "Insufficient balance";
      err.detail = `Need $${(amountCents / 100).toFixed(2)} but wallet has $${(balance / 100).toFixed(2)}.`;
      err.hint = "Add funds via Wallet → Top up with Stripe.";
      err.balanceCents = balance;
      err.requiredCents = amountCents;
      throw err;
    }
    user.walletBalanceCents = balance - amountCents;
    await user.save({ session });

    const [tx] = await WalletTransaction.create(
      [
        {
          user: user._id,
          type: opts.type,
          amountCents: -amountCents,
          balanceAfterCents: user.walletBalanceCents,
          note: opts.note || "",
          agent: opts.agentId || null,
          meta: opts.meta || {},
        },
      ],
      { session }
    );

    await session.commitTransaction();
    return {
      balanceCents: user.walletBalanceCents,
      transaction: tx,
    };
  } catch (err) {
    await session.abortTransaction();
    throw err;
  } finally {
    session.endSession();
  }
}

/**
 * @param {string} userId
 * @param {{ limit?: number }} [opts]
 */
export async function listWalletTransactions(userId, opts = {}) {
  const limit = Math.min(100, Math.max(1, Number(opts.limit) || 30));
  return WalletTransaction.find({ user: userId })
    .sort({ createdAt: -1 })
    .limit(limit)
    .lean();
}
