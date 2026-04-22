export const handler = async (event) => {
    const headers = {
        'Access-Control-Allow-Origin': '*',
        'Content-Type': 'application/json'
    };

    if (event.httpMethod === 'OPTIONS') {
        return { statusCode: 204, headers, body: '' };
    }

    try {
        console.log('=== INITIALIZE PAYMENT CALLED ===');
        
        // Parse the request body
        let body = {};
        try {
            body = JSON.parse(event.body || '{}');
            console.log('Request body:', JSON.stringify(body));
        } catch (e) {
            console.log('Failed to parse body:', e.message);
        }
        
        // Return a simple success response for testing
        return {
            statusCode: 200,
            headers,
            body: JSON.stringify({
                success: true,
                authorization_url: 'https://checkout.paystack.com/mock',
                reference: 'mock_' + Date.now(),
                message: 'Test mode - payment function is working'
            })
        };
        
    } catch (error) {
        console.error('Fatal error:', error);
        return {
            statusCode: 500,
            headers,
            body: JSON.stringify({ error: error.message })
        };
    }
};
