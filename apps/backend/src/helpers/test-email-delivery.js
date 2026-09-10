/*
 * Sends one real email and prints the outcome. `npm run test:email <address>`.
 *
 * The point is to answer "can this install actually deliver mail?" WITHOUT
 * going through sign-in. The OTP endpoint deliberately answers 200 whether or
 * not delivery succeeded (it must not leak whether an address exists), so a
 * successful sign-in request proves nothing about the provider. This does.
 *
 * It calls the same sendMailQuietly the application uses, so it exercises the
 * live driver selection, credential and sender address — not a parallel path
 * that could pass while the real one fails.
 *
 * Touches no database and writes nothing, so it is safe to run against a
 * production install.
 */
require("dotenv").config();

const { applicationConfig } = require("../config/application-config");
const {
  sendMailQuietly,
  getActiveEmailDriverName,
  EMAIL_DRIVERS,
} = require("../services/email-service");

function readRecipientAddress() {
  const recipient = process.argv[2];
  if (!recipient || !recipient.includes("@")) {
    throw new Error(
      "Pass the recipient address: npm run test:email -- you@example.com"
    );
  }
  return recipient.trim();
}

async function testEmailDelivery() {
  const recipient = readRecipientAddress();
  const driverName = getActiveEmailDriverName();
  const sentAt = new Date().toISOString();

  console.log(`Driver:      ${driverName}`);
  console.log(`From:        ${applicationConfig.emailFromAddress}`);
  console.log(`From name:   ${applicationConfig.emailFromName || "(none)"}`);
  console.log(`Environment: ${applicationConfig.applicationEnvironment}`);
  console.log(`To:          ${recipient}`);
  console.log("");

  if (driverName === EMAIL_DRIVERS.CONSOLE) {
    console.log(
      "NOTE: the console driver is active (RESEND_API_KEY is unset in development),\n" +
        "so nothing will leave this machine — the message is printed below instead.\n" +
        "Set RESEND_API_KEY to test real delivery.\n"
    );
  }

  const wasSent = await sendMailQuietly({
    to: recipient,
    subject: "Dedal delivery test",
    text:
      `This is a delivery test from the Dedal backend.\n\n` +
      `Driver: ${driverName}\n` +
      `Sent at: ${sentAt}\n\n` +
      `If you received this, email delivery is working.`,
  });

  console.log("");
  if (wasSent) {
    console.log("RESULT: SENT — the provider accepted the message.");
    if (driverName === EMAIL_DRIVERS.RESEND) {
      console.log(
        "Check the inbox (and spam). Acceptance is not proof of inbox placement:\n" +
          "an unverified sending domain can still be accepted and then dropped."
      );
    }
    return 0;
  }

  console.error("RESULT: FAILED — see the delivery error logged above.");
  console.error(
    "Common causes: RESEND_API_KEY missing or revoked, or EMAIL_FROM_ADDRESS using a\n" +
      "domain not verified in Resend (Resend rejects unverified senders)."
  );
  return 1;
}

async function main() {
  try {
    process.exitCode = await testEmailDelivery();
  } catch (error) {
    console.error(`Email delivery test failed: ${error.message}`);
    process.exitCode = 1;
  }
  /*
   * Sets exitCode and lets the loop drain, rather than calling process.exit():
   * fetch's socket is still closing when this returns, and tearing the process
   * down under it trips a libuv assertion on Windows. Nothing here holds the
   * loop open, so the process still exits promptly on its own.
   */
}

main();
