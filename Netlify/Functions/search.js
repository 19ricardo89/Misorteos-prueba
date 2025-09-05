const fs = require('fs');
const path = require('path');

// --- Función Auxiliar para leer los prompts ---
const readPromptFromFile = (fileName) => {
    const filePath = path.join(__dirname, `../prompts/${fileName}`);
    return fs.readFileSync(filePath, 'utf8');
};

// --- Función para llamar a la API de Gemini (robusta) ---
const callGeminiAPI = async (prompt) => {
    const fetch = (await import('node-fetch')).default;
    const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
    if (!GEMINI_API_KEY) {
        throw new Error("La clave de API de Gemini no está configurada.");
    }
    const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash-latest:generateContent?key=${GEMINI_API_KEY}`;
    const payload = { contents: [{ role: "user", parts: [{ text: prompt }] }] };

    try {
        const response = await fetch(apiUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        const data = await response.json();

        if (!response.ok || !data.candidates || data.candidates.length === 0) {
            console.error("Respuesta de error o inesperada de la API de Gemini:", JSON.stringify(data));
            throw new Error(`Error de la API: ${data.error?.message || 'Respuesta inválida'}`);
        }
        
        const text = data.candidates[0].content.parts[0].text;
        const cleanText = text.replace(/```json/g, '').replace(/```/g, '').trim();
        return JSON.parse(cleanText);

    } catch (error) {
        console.error("Error detallado en callGeminiAPI de search.js:", error);
        // Devolvemos un valor por defecto en caso de fallo en la tasación
        return { price: "~0€", appraisal_notes: "Error durante la búsqueda de valor.", url: null, winner_count: 1 };
    }
};

// --- Handler Principal de la Función ---
exports.handler = async function (event, context) {
    if (event.httpMethod !== 'POST') {
        return { statusCode: 405, body: 'Method Not Allowed' };
    }

    try {
        const { prize_name, accounts_list } = JSON.parse(event.body);
        if (!prize_name) {
            return { statusCode: 400, body: JSON.stringify({ error: 'No se proporcionó nombre del premio.' }) };
        }

        // 1. Leer la plantilla del prompt
        let appraiserPrompt = readPromptFromFile('5_price_appraiser.txt');

        // 2. Inyectar los datos dinámicos en la plantilla
        appraiserPrompt = appraiserPrompt.replace('${prize_name}', prize_name);
        appraiserPrompt = appraiserPrompt.replace('${accounts_list}', accounts_list.join(', '));

        // 3. Llamar a la API con el prompt completo
        const result = await callGeminiAPI(appraiserPrompt);

        return {
            statusCode: 200,
            body: JSON.stringify(result)
        };
    } catch (error) {
        console.error("Error en search.js:", error.toString());
        return {
            statusCode: 500,
            body: JSON.stringify({ error: 'Error en la función de tasación.', details: error.message })
        };
    }
};
