/**
 * @fileoverview Wallet ledger entries — credits and debits per user.
 * Purpose: Audit trail for Stripe top-ups, agent purchases, and admin grants.
 * Downstream: wallet utils, wallet API, admin credits.
 */

import mongoose from "mongoose";

export const WALLET_TX_TYPES = [
  "stripe_topup",
  "admin_credit",
  "agent_create",
  "refund",
];

const walletTransactionSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    type: {
      type: String,
      enum: WALLET_TX_TYPES,
      required: true,
    },
    /** Positive = credit, negative = debit (cents). */
    amountCents: { type: Number, required: true },
    balanceAfterCents: { type: Number, required: true },
    note: { type: String, default: "", trim: true },
    /** Idempotency for Stripe — unique when set. */
    stripeSessionId: { type: String, default: null, index: true, sparse: true },
    stripePaymentIntentId: { type: String, default: null },
    agent: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Agent",
      default: null,
    },
    adminUser: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    meta: { type: mongoose.Schema.Types.Mixed, default: {} },
  },
  { timestamps: true }
);

walletTransactionSchema.index({ user: 1, createdAt: -1 });
walletTransactionSchema.index({ stripeSessionId: 1 }, { unique: true, sparse: true });

export const WalletTransaction = mongoose.model("WalletTransaction", walletTransactionSchema);
