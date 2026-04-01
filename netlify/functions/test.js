export const handler = async (event) => {
    return {
        statusCode: 200,
        body: JSON.stringify({ 
            message: 'Function working!', 
            time: new Date().toISOString(),
            method: event.httpMethod
        })
    };
};
