// netlify/functions/initialize-payment.js
const { createClient } = require('@supabase/supabase-js');
const https = require('https');

exports.handler = async (event, context) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Content-Type': 'application/json'
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers };
  }

  // Use service role key for backend operations (bypasses RLS)
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY; // Use service role, not anon key
  const paystackSecret = process.env.PAYSTACK_SECRET_KEY;

  console.log('Environment check:', {
    supabaseUrl: supabaseUrl ? 'Set' : 'Missing',
    supabaseServiceKey: supabaseServiceKey ? 'Set' : 'Missing',
    paystackSecret: paystackSecret ? 'Set' : 'Missing'
  });

  if (!supabaseUrl || !supabaseServiceKey) {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ 
        error: 'Configuration error',
        message: 'Payment system not properly configured'
      })
    };
  }

  try {
    const body = JSON.parse(event.body);
    const { email, name, amount, productId, quantity = 1, items = [] } = body;
    
    console.log('=== PAYMENT INITIALIZATION ===');
    console.log('Request:', { email, name, amount, productId, quantity });
    
    if (!email) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'Email is required' })
      };
    }
    
    if (!amount || amount <= 0) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'Valid amount is required' })
      };
    }
    
    // Create Supabase client with SERVICE ROLE key (bypasses RLS)
    const supabase = createClient(supabaseUrl, supabaseServiceKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false
      }
    });
    
    // Format items array
    let itemsArray = [];
    if (Array.isArray(items) && items.length > 0) {
      itemsArray = items;
    } else if (productId) {
      itemsArray = [{
        product_id: productId,
        quantity: parseInt(quantity) || 1
      }];
    }
    
    console.log('Items to save:', JSON.stringify(itemsArray));
    
    // Create the order - service role bypasses RLS
    const orderData = {
      email: email,
      customer_name: name || email.split('@')[0],
      items: itemsArray,
      total_amount: parseFloat(amount),
      status: 'pending',
      payment_status: 'pending',
      created_at: new Date().toISOString()
    };
    
    console.log('Inserting order with service role...');
    
    const { data: result, error: insertError } = await supabase
      .from('orders')
      .insert(orderData)
      .select();
    
    if (insertError) {
      console.error('Insert error details:', insertError);
      throw new Error(`Database insert failed: ${insertError.message}`);
    }
    
    const orderId = result && result[0] ? result[0].id : null;
    console.log('✅ Order created successfully:', orderId);
    
    // Process Paystack payment
    if (paystackSecret) {
      const paystackPayload = JSON.stringify({
        email: email,
        amount: Math.round(parseFloat(amount) * 100),
        currency: 'GHS',
        metadata: {
          order_id: orderId,
          customer_email: email
        }
      });
      
      const paystackOptions = {
        hostname: 'api.paystack.co',
        port: 443,
        path: '/transaction/initialize',
        method: 'POST',
        headers: {
          Authorization: `Bearer ${paystackSecret}`,
          'Content-Type': 'application/json'
        }
      };
      
      const paystackResponse = await new Promise((resolve, reject) => {
        const req = https.request(paystackOptions, (res) => {
          let data = '';
          res.on('data', (chunk) => data += chunk);
          res.on('end', () => {
            try {
              resolve(JSON.parse(data));
            } catch (e) {
              reject(e);
            }
          });
        });
        req.on('error', reject);
        req.write(paystackPayload);
        req.end();
      });
      
      if (paystackResponse.status) {
        console.log('✅ Paystack payment URL created');
        return {
          statusCode: 200,
          headers,
          body: JSON.stringify({
            success: true,
            authorization_url: paystackResponse.data.authorization_url,
            reference: paystackResponse.data.reference,
            order_id: orderId
          })
        };
      } else {
        console.error('Paystack error:', paystackResponse.message);
        return {
          statusCode: 200,
          headers,
          body: JSON.stringify({
            success: true,
            order_id: orderId,
            message: 'Order created but payment initialization failed',
            payment_error: paystackResponse.message
          })
        };
      }
    }
    
    // Success without Paystack
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        order_id: orderId,
        message: 'Order created successfully'
      })
    };
    
  } catch (error) {
    console.error('Fatal error:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ 
        error: 'Internal server error',
        message: error.message
      })
    };
  }
};
