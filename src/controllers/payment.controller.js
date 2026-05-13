// =============================================
//  payment.controller.js — REAL CHAPA INTEGRATION
//  Seeker pays 100 ETB → unlocks provider contact
//  Provider pays 20 ETB → unlocks seeker contact
// =============================================

const db = require('../config/db');
const { decrypt } = require('../utils/encryption');

const CHAPA_SECRET_KEY = process.env.CHAPA_SECRET_KEY;
const CHAPA_BASE_URL   = 'https://api.chapa.co/v1';
const APP_URL          = process.env.APP_URL || 'https://neighborhood-backend-production.up.railway.app';

// ─────────────────────────────────────────────
//  INITIATE PAYMENT
//  POST /api/payments/initiate
//  Body: { request_id, payer_role }
// ─────────────────────────────────────────────
async function initiatePayment(req, res) {
  try {
    const { request_id, payer_role } = req.body;
    const userId = req.user.id;

    if (!request_id || !payer_role) {
      return res.status(400).json({ message: 'request_id and payer_role are required' });
    }

    if (!['seeker', 'provider'].includes(payer_role)) {
      return res.status(400).json({ message: 'payer_role must be seeker or provider' });
    }

    // Check request exists
    const [requests] = await db.query(
      'SELECT * FROM service_requests WHERE id = ?', [request_id]
    );
    if (requests.length === 0) {
      return res.status(404).json({ message: 'Service request not found' });
    }

    // Set amount
    const amount = payer_role === 'seeker' ? 100 : 20;

    // Check if already paid
    const [existingPayments] = await db.query(
      `SELECT * FROM payments
       WHERE request_id = ? AND user_id = ? AND payer_role = ? AND status = 'completed'`,
      [request_id, userId, payer_role]
    );
    if (existingPayments.length > 0) {
      return res.status(400).json({ message: 'Payment already completed for this request' });
    }

    // Get user info
    const [users] = await db.query('SELECT name FROM users WHERE id = ?', [userId]);

    // Create unique transaction reference
    const txRef = `NSF-${request_id}-${userId}-${Date.now()}`;

    // Save pending payment record
    await db.query(
      `INSERT INTO payments (request_id, user_id, amount, payer_role, gateway_tx_id, status)
       VALUES (?, ?, ?, ?, ?, 'pending')`,
      [request_id, userId, amount, payer_role, txRef]
    );

    // Call Chapa API to create payment
    const chapaResponse = await fetch(`${CHAPA_BASE_URL}/transaction/initialize`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${CHAPA_SECRET_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        amount:       amount.toString(),
        currency:     'ETB',
        email:        `user${userId}@neighborhoodapp.com`,
        first_name:   users[0].name.split(' ')[0] || users[0].name,
        last_name:    users[0].name.split(' ')[1] || '',
        tx_ref:       txRef,
        callback_url: `${APP_URL}/api/payments/chapa-callback`,
        return_url:   `${APP_URL}/api/payments/success?tx_ref=${txRef}`,
        customization: {
          title:       'Neighborhood Service Finder',
          description: payer_role === 'seeker'
            ? 'Commitment fee - unlock provider contact'
            : 'Service fee - unlock seeker contact'
        }
      })
    });

    const chapaData = await chapaResponse.json();

    if (chapaData.status !== 'success') {
      console.error('Chapa error:', chapaData);
      return res.status(400).json({
        message: 'Payment initiation failed',
        error: chapaData.message
      });
    }

    return res.status(200).json({
      message: `Payment initiated! Amount: ${amount} ETB`,
      tx_ref:       txRef,
      amount,
      payer_role,
      payment_url:  chapaData.data.checkout_url
    });

  } catch (err) {
    console.error('InitiatePayment error:', err);
    return res.status(500).json({ message: 'Server error initiating payment' });
  }
}


// ─────────────────────────────────────────────
//  CHAPA CALLBACK (Webhook)
//  POST /api/payments/chapa-callback
//  Called automatically by Chapa after payment
// ─────────────────────────────────────────────
async function chapaCallback(req, res) {
  try {
    const { trx_ref } = req.body;
    if (trx_ref) {
      await processPayment(trx_ref);
    }
    return res.status(200).json({ message: 'OK' });
  } catch (err) {
    console.error('Chapa callback error:', err);
    return res.status(500).json({ message: 'Callback error' });
  }
}


// ─────────────────────────────────────────────
//  SUCCESS REDIRECT
//  GET /api/payments/success?tx_ref=xxx
//  User is redirected here after paying
// ─────────────────────────────────────────────
async function paymentSuccess(req, res) {
  try {
    const { tx_ref } = req.query;
    if (!tx_ref) return res.status(400).send('Missing tx_ref');

    const result = await processPayment(tx_ref);
    return res.status(200).json({
      message: '✅ Payment successful! Contact details unlocked.',
      unlocked_contact: result
    });

  } catch (err) {
    console.error('Payment success error:', err);
    return res.status(500).json({ message: 'Error processing payment' });
  }
}


// ─────────────────────────────────────────────
//  VERIFY PAYMENT (Manual check from app)
//  POST /api/payments/verify
//  Body: { tx_ref }
// ─────────────────────────────────────────────
async function verifyPayment(req, res) {
  try {
    const { tx_ref } = req.body;
    if (!tx_ref) return res.status(400).json({ message: 'tx_ref is required' });

    // Check if already completed
    const [payments] = await db.query(
      `SELECT * FROM payments WHERE gateway_tx_id = ?`, [tx_ref]
    );

    if (payments.length === 0) {
      return res.status(404).json({ message: 'Payment record not found' });
    }

    if (payments[0].status === 'completed') {
      // Already processed — just return the contact info
      const contact = await getUnlockedContact(payments[0]);
      return res.status(200).json({
        message: '✅ Payment already verified! Contact details unlocked.',
        unlocked_contact: contact
      });
    }

    // Verify with Chapa
    const chapaVerify = await fetch(`${CHAPA_BASE_URL}/transaction/verify/${tx_ref}`, {
      headers: { 'Authorization': `Bearer ${CHAPA_SECRET_KEY}` }
    });
    const chapaData = await chapaVerify.json();

    if (chapaData.status !== 'success' || chapaData.data?.status !== 'success') {
      return res.status(400).json({
        message: 'Payment not confirmed by Chapa yet. Please wait and try again.',
        chapa_status: chapaData.data?.status
      });
    }

    const contact = await processPayment(tx_ref);
    return res.status(200).json({
      message: '✅ Payment verified! Contact details unlocked.',
      unlocked_contact: contact
    });

  } catch (err) {
    console.error('VerifyPayment error:', err);
    return res.status(500).json({ message: 'Server error verifying payment' });
  }
}


// ─────────────────────────────────────────────
//  HELPER: Process payment and unlock contacts
// ─────────────────────────────────────────────
async function processPayment(txRef) {
  const [payments] = await db.query(
    `SELECT p.*, sr.seeker_id, sr.status AS request_status
     FROM payments p
     JOIN service_requests sr ON sr.id = p.request_id
     WHERE p.gateway_tx_id = ?`,
    [txRef]
  );

  if (payments.length === 0) return null;
  const payment = payments[0];
  if (payment.status === 'completed') {
    return await getUnlockedContact(payment);
  }

  // Mark payment as completed
  await db.query(
    `UPDATE payments SET status = 'completed' WHERE gateway_tx_id = ?`,
    [txRef]
  );

  return await getUnlockedContact(payment);
}


// ─────────────────────────────────────────────
//  HELPER: Get unlocked contact based on who paid
// ─────────────────────────────────────────────
async function getUnlockedContact(payment) {
  if (payment.payer_role === 'seeker') {
    // Seeker paid 100 ETB → update request status and show provider phone
    await db.query(
      `UPDATE service_requests SET status = 'paid' WHERE id = ?`,
      [payment.request_id]
    );

    const [assignments] = await db.query(
      `SELECT u.name, u.phone
       FROM job_assignments ja
       JOIN users u ON u.id = ja.provider_id
       WHERE ja.request_id = ? AND ja.status = 'accepted'`,
      [payment.request_id]
    );

    if (assignments.length > 0) {
      const decryptedPhone = decrypt(assignments[0].phone.toString('hex'));
      return { provider_name: assignments[0].name, provider_phone: decryptedPhone };
    }

  } else if (payment.payer_role === 'provider') {
    // Provider paid 20 ETB → show seeker phone
    const [seekers] = await db.query(
      `SELECT u.name, u.phone
       FROM service_requests sr
       JOIN users u ON u.id = sr.seeker_id
       WHERE sr.id = ?`,
      [payment.request_id]
    );

    if (seekers.length > 0) {
      const decryptedPhone = decrypt(seekers[0].phone.toString('hex'));
      return { seeker_name: seekers[0].name, seeker_phone: decryptedPhone };
    }
  }
  return null;
}


// ─────────────────────────────────────────────
//  GET PAYMENT HISTORY
//  GET /api/payments/history
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

module.exports = {
  initiatePayment,
  verifyPayment,
  chapaCallback,
  paymentSuccess,
  getPaymentHistory
};