// =============================================
//  payment.controller.js
//  Handles Chapa payment integration
//  - Seeker pays 100 ETB to unlock provider contact
//  - Provider pays 20 ETB to unlock seeker contact
//
//  HOW CHAPA WORKS (simple explanation):
//  1. We call Chapa API to create a payment link
//  2. User pays on Chapa's page
//  3. Chapa calls our /verify endpoint to confirm
//  4. We unlock the contact details
// =============================================

const db   = require('../config/db');
const { decrypt } = require('../utils/encryption');

// Chapa API details
// Sign up at dashboard.chapa.co to get your secret key
const CHAPA_SECRET_KEY = process.env.CHAPA_SECRET_KEY || 'your-chapa-secret-key-here';
const CHAPA_BASE_URL   = 'https://api.chapa.co/v1';


// ─────────────────────────────────────────────
//  INITIATE PAYMENT
//  POST /api/payments/initiate
//  Who can call: seeker or provider
//  Body: { request_id, payer_role }
//  payer_role: "seeker" (100 ETB) or "provider" (20 ETB)
// ─────────────────────────────────────────────
async function initiatePayment(req, res) {
  try {
    const { request_id, payer_role } = req.body;
    const userId = req.user.id;

    // 1. Validate inputs
    if (!request_id || !payer_role) {
      return res.status(400).json({ message: 'request_id and payer_role are required' });
    }

    if (!['seeker', 'provider'].includes(payer_role)) {
      return res.status(400).json({ message: 'payer_role must be seeker or provider' });
    }

    // 2. Make sure the request exists
    const [requests] = await db.query(
      'SELECT * FROM service_requests WHERE id = ?',
      [request_id]
    );

    if (requests.length === 0) {
      return res.status(404).json({ message: 'Service request not found' });
    }

    // 3. Set amount based on who is paying
    //    Seeker pays 100 ETB, Provider pays 20 ETB
    const amount = payer_role === 'seeker' ? 100 : 20;

    // 4. Check if payment already done for this role
    const [existingPayments] = await db.query(
      `SELECT * FROM payments
       WHERE request_id = ? AND user_id = ? AND payer_role = ? AND status = 'completed'`,
      [request_id, userId, payer_role]
    );

    if (existingPayments.length > 0) {
      return res.status(400).json({ message: 'Payment already completed for this request' });
    }

    // 5. Get user info for Chapa
    const [users] = await db.query(
      'SELECT name FROM users WHERE id = ?',
      [userId]
    );

    // 6. Create a unique transaction reference
    //    This is how we identify the payment when Chapa calls back
    const txRef = `NSF-${request_id}-${userId}-${Date.now()}`;

    // 7. Save pending payment record in our database
    await db.query(
      `INSERT INTO payments (request_id, user_id, amount, payer_role, gateway_tx_id, status)
       VALUES (?, ?, ?, ?, ?, 'pending')`,
      [request_id, userId, amount, payer_role, txRef]
    );

    // 8. Call Chapa API to create payment link
    //    In production, uncomment this and use real Chapa credentials
    /*
    const chapaResponse = await fetch(`${CHAPA_BASE_URL}/transaction/initialize`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${CHAPA_SECRET_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        amount: amount,
        currency: 'ETB',
        email: 'payment@neighborhoodapp.com',
        first_name: users[0].name,
        tx_ref: txRef,
        callback_url: `${process.env.APP_URL}/api/payments/verify`,
        return_url: `${process.env.APP_URL}/payment-success`,
        customization: {
          title: 'Neighborhood Service Finder',
          description: payer_role === 'seeker'
            ? 'Commitment fee to connect with provider'
            : 'Service fee to accept job'
        }
      })
    });
    const chapaData = await chapaResponse.json();
    const paymentUrl = chapaData.data.checkout_url;
    */

    // For testing (sandbox mode) — return the tx_ref so we can manually verify
    return res.status(200).json({
      message: `Payment initiated! Amount: ${amount} ETB`,
      tx_ref: txRef,
      amount,
      payer_role,
      // payment_url: paymentUrl  // uncomment when using real Chapa
      note: 'Use tx_ref to verify payment via POST /api/payments/verify'
    });

  } catch (err) {
    console.error('InitiatePayment error:', err);
    return res.status(500).json({ message: 'Server error initiating payment' });
  }
}


// ─────────────────────────────────────────────
//  VERIFY PAYMENT
//  POST /api/payments/verify
//  Body: { tx_ref }
//  Called after Chapa confirms payment
//  In production Chapa calls this automatically (webhook)
//  For testing we call it manually
// ─────────────────────────────────────────────
async function verifyPayment(req, res) {
  try {
    const { tx_ref } = req.body;

    if (!tx_ref) {
      return res.status(400).json({ message: 'tx_ref is required' });
    }

    // 1. Find the pending payment
    const [payments] = await db.query(
      `SELECT p.*, sr.seeker_id, sr.status AS request_status
       FROM payments p
       JOIN service_requests sr ON sr.id = p.request_id
       WHERE p.gateway_tx_id = ?`,
      [tx_ref]
    );

    if (payments.length === 0) {
      return res.status(404).json({ message: 'Payment record not found' });
    }

    const payment = payments[0];

    if (payment.status === 'completed') {
      return res.status(400).json({ message: 'Payment already verified' });
    }

    // 2. In production: verify with Chapa API
    //    Uncomment below when using real Chapa credentials
    /*
    const chapaVerify = await fetch(`${CHAPA_BASE_URL}/transaction/verify/${tx_ref}`, {
      headers: { 'Authorization': `Bearer ${CHAPA_SECRET_KEY}` }
    });
    const chapaData = await chapaVerify.json();
    if (chapaData.data.status !== 'success') {
      return res.status(400).json({ message: 'Payment not confirmed by Chapa' });
    }
    */

    // 3. Mark payment as completed
    await db.query(
      `UPDATE payments SET status = 'completed' WHERE gateway_tx_id = ?`,
      [tx_ref]
    );

    // 4. Unlock contact details based on who paid
    let unlockedContact = null;

    if (payment.payer_role === 'seeker') {
      // Seeker paid 100 ETB → show provider phone number
      // Update request status to 'paid'
      await db.query(
        `UPDATE service_requests SET status = 'paid' WHERE id = ?`,
        [payment.request_id]
      );

      // Get provider info for this request
      const [assignments] = await db.query(
        `SELECT u.name, u.phone
         FROM job_assignments ja
         JOIN users u ON u.id = ja.provider_id
         WHERE ja.request_id = ? AND ja.status = 'accepted'`,
        [payment.request_id]
      );

      if (assignments.length > 0) {
        // Decrypt the provider's phone number
        const decryptedPhone = decrypt(assignments[0].phone.toString('hex'));
        unlockedContact = {
          provider_name: assignments[0].name,
          provider_phone: decryptedPhone
        };
      }

    } else if (payment.payer_role === 'provider') {
      // Provider paid 20 ETB → show seeker phone number
      const [seekers] = await db.query(
        `SELECT u.name, u.phone
         FROM service_requests sr
         JOIN users u ON u.id = sr.seeker_id
         WHERE sr.id = ?`,
        [payment.request_id]
      );

      if (seekers.length > 0) {
        const decryptedPhone = decrypt(seekers[0].phone.toString('hex'));
        unlockedContact = {
          seeker_name: seekers[0].name,
          seeker_phone: decryptedPhone
        };
      }
    }

    return res.status(200).json({
      message: '✅ Payment verified! Contact details unlocked.',
      unlocked_contact: unlockedContact
    });

  } catch (err) {
    console.error('VerifyPayment error:', err);
    return res.status(500).json({ message: 'Server error verifying payment' });
  }
}


// ─────────────────────────────────────────────
//  GET PAYMENT HISTORY
//  GET /api/payments/history
//  Who can call: any logged in user
// ─────────────────────────────────────────────
async function getPaymentHistory(req, res) {
  try {
    const userId = req.user.id;

    const [payments] = await db.query(
      `SELECT p.id, p.amount, p.payer_role, p.status, p.created_at,
              sr.description AS request_description
       FROM payments p
       JOIN service_requests sr ON sr.id = p.request_id
       WHERE p.user_id = ?
       ORDER BY p.created_at DESC`,
      [userId]
    );

    return res.status(200).json({ payments });

  } catch (err) {
    console.error('GetPaymentHistory error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
}

module.exports = { initiatePayment, verifyPayment, getPaymentHistory };