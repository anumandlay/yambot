/**
 * @fileoverview Wallet API — balance, Stripe top-up, transaction history.
 * Purpose: User prepaid credits for agent creation and future usage billing.
 * Downstream: wallet utils, Stripe webhook, agent create debits.
 */

import { Router } from "express";
import { User } from "../models/User.js";
import { env } from "../utils/env.js";
import {
  getWalletSummary,
  listWalletTransactions,
  creditWallet,
} from "../utils/wallet.js";
import {
  createWalletCheckoutSession,
  getStripe,
  isStripeConfigured,
} from "../utils/stripeClient.js";
import { getPlatformSettings, toPlatformSettingsPublic } from "../models/PlatformSettings.js";

export const walletRouter = Router();

/**
 * GET /api/wallet — balance, pricing hint, Stripe availability.
 */
walletRouter.get("/", async (req, res, next) => {
  try {
    const [summary, transactions, settings] = await Promise.all([
      getWalletSummary(req.userId),
      listWalletTransactions(req.userId, { limit: 40 }),
      getPlatformSettings(),
    ]);
    const pricing = toPlatformSettingsPublic(settings);
    res.json({
      ok: true,
      wallet: summary,
      stripeConfigured: isStripeConfigured(),
      agentPriceUsd: pricing.agentPriceUsd,
      agentPriceCents: pricing.agentPriceCents,
      transactions: transactions.map((t) => ({
        id: t._id,
        type: t.type,
        amountCents: t.amountCents,
        amountUsd: Number((t.amountCents / 100).toFixed(2)),
        balanceAfterCents: t.balanceAfterCents,
        note: t.note,
        createdAt: t.createdAt,
      })),
    });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/wallet/checkout — create Stripe Checkout for wallet top-up.
 * Body: { amountUsd: number }
 */
walletRouter.post("/checkout", async (req, res, next) => {
  try {
    const amountUsd = Number(req.body?.amountUsd);
    const amountCents = Math.round(amountUsd * 100);
    const user = await User.findById(req.userId).select("email").lean();
    if (!user) {
      res.status(404).json({ ok: false, detail: "User missing" });
      return;
    }
    const session = await createWalletCheckoutSession(req.userId, amountCents, user.email);
    res.json({
      ok: true,
      checkoutUrl: session.url,
      sessionId: session.id,
    });
  } catch (err) {
    next(err);
  }
});

/**
 * Stripe webhook — mounted with express.raw in index.js (no JSON parser).
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 */
export async function handleStripeWebhook(req, res) {
  const stripe = getStripe();
  if (!stripe) {
    res.status(503).send("Stripe not configured");
    return;
  }

  const sig = req.headers["stripe-signature"];
  if (!sig || !env.STRIPE_WEBHOOK_SECRET) {
    res.status(400).send("Webhook secret missing");
    return;
  }

  let event;
  try {
    event = stripe.webhooks.constructEvent(req.body, sig, env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error("[stripe webhook] signature failed", err.message);
    res.status(400).send(`Webhook Error: ${err.message}`);
    return;
  }

  try {
    if (event.type === "checkout.session.completed") {
      const session = event.data.object;
      if (session.metadata?.purpose !== "wallet_topup") {
        res.json({ received: true, skipped: true });
        return;
      }
      const userId = session.metadata?.userId;
      const amountCents =
        Number(session.metadata?.amountCents) ||
        Number(session.amount_total) ||
        0;
      if (!userId || amountCents <= 0) {
        res.status(400).send("Invalid session metadata");
        return;
      }
      await creditWallet({
        userId,
        amountCents,
        type: "stripe_topup",
        note: `Stripe checkout ${session.id}`,
        stripeSessionId: session.id,
        stripePaymentIntentId: String(session.payment_intent || ""),
        meta: { eventId: event.id },
      });
    }
    res.json({ received: true });
  } catch (err) {
    console.error("[stripe webhook] handler error", err);
    res.status(500).send("Webhook handler failed");
  }
}
