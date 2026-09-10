import { createRequire } from "node:module";

/*
 * Stands in for src/services/razorpay-client.js so no test opens a network
 * connection to Razorpay. Mirrors test-email-service: seed Node's require cache for
 * the client module BEFORE the CJS service graph loads (services capture exports by
 * destructuring require() at load time, so this must run first). Signature
 * verification is pure crypto and is NOT stubbed — tests exercise it for real.
 */
const recordedOrders = [];
let orderCounter = 0;

export async function createRazorpayOrder({ amountPaise, receipt }) {
  orderCounter += 1;
  const razorpayOrderId = `order_test_${orderCounter}`;
  recordedOrders.push({ razorpayOrderId, amountPaise, receipt });
  return { razorpayOrderId };
}

export function getRecordedOrders() {
  return [...recordedOrders];
}

export function clearRecordedOrders() {
  recordedOrders.length = 0;
  orderCounter = 0;
}

export function installRazorpayClientMock() {
  const nodeRequire = createRequire(import.meta.url);
  const modulePath = nodeRequire.resolve("../../src/services/razorpay-client.js");
  nodeRequire.cache[modulePath] = {
    id: modulePath,
    filename: modulePath,
    loaded: true,
    exports: { createRazorpayOrder },
  };
}
