/**
 * @fileoverview Stripe client for wallet top-ups.
 * Purpose: Lazy-init Stripe SDK from env; checkout sessions for wallet credits.
 * Downstream: wallet routes, webhook handler.
 */

import Stripe from "stripe";
import { env } from "./env.js";

/** @type {Stripe | null} */
let stripe = null;

/**
 * @returns {Stripe | null}
 */
export function getStripe() {
  if (!env.STRIPE_SECRET_KEY) return null;
  if (!stripe) {
    stripe = new Stripe(env.STRIPE_SECRET_KEY);
  }
  return stripe;
}

/**
 * @returns {boolean}
 */
export function isStripeConfigured() {
  return Boolean(env.STRIPE_SECRET_KEY);
}

/**
 * @param {string} userId
 * @param {number} amountCents
 * @param {string} email
 */
export async function createWalletCheckoutSession(userId, amountCents, email) {
  const client = getStripe();
  if (!client) {
    const err = new Error("Stripe is not configured on this server");
    err.status = 503;
    err.title = "Payments unavailable";
    err.detail = "STRIPE_SECRET_KEY is not set.";
    throw err;
  }

  const cents = Math.round(amountCents);
  if (cents < 100) {
    const err = new Error("Minimum top-up is $1.00");
    err.status = 400;
    throw err;
  }
  if (cents > 500_000) {
    const err = new Error("Maximum top-up is $5,000 per transaction");
    err.status = 400;
    throw err;
  }

  const webBase = env.PUBLIC_WEB_URL.replace(/\/$/, "");
  const session = await client.checkout.sessions.create({
    mode: "payment",
    customer_email: email || undefined,
    line_items: [
      {
        price_data: {
          currency: "usd",
          unit_amount: cents,
          product_data: {
            name: "YamBot wallet credit",
            description: "Prepaid balance for agents and platform usage",
          },
        },
        quantity: 1,
      },
    ],
    metadata: {
      userId: String(userId),
      purpose: "wallet_topup",
      amountCents: String(cents),
    },
    success_url: `${webBase}/wallet?success=1&session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${webBase}/wallet?canceled=1`,
  });

  return session;
}
