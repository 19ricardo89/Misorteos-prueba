// netlify/functions/gemini.js
exports.handler = async function (event, context) {
    const fetch = (await import('node-fetch')).default;
    const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
    const body = JSON.parse(event.body);
    const { base64Data, dynamicPrompt } = body;
    if (!base64Data || !dynamicPrompt) {
        return {
            statusCode: 400,
            body: JSON.stringify({ error: 'Faltan datos en la petición.' })
        };
    }
    const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash-latest:generateContent?key=${GEMINI_API_KEY}`;
    const payload = {
        contents: [{
            role: "user",
            parts: [
                { text: dynamicPrompt },
                { inlineData: { mimeType: "image/jpeg", data: base64Data.split(',')[1] } }
            ]
        }]
    };
    try {
        const geminiResponse = await fetch(apiUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        if (!geminiResponse.ok) {
            const errorBody = await geminiResponse.json();
            console.error("Error desde la API de Gemini:", errorBody);
            return {
                statusCode: geminiResponse.status,
                body: JSON.stringify({ error: 'La API de Gemini devolvió un error.', details: errorBody })
            };
        }
        const data = await geminiResponse.json();
        return {
            statusCode: 200,
            body: JSON.stringify(data)
        };
    } catch (error) {
        console.error("Error en la función de Netlify:", error);
        return {
            statusCode: 500,
            body: JSON.stringify({ error: 'Error al contactar la API de Gemini.' })
        };
    }
};