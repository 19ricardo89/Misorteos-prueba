const fs = require('fs');
const path = require('path');

// Función auxiliar para leer los prompts de los archivos
const readPromptFromFile = (fileName) => {
    const filePath = path.join(__dirname, `../prompts/${fileName}`);
    return fs.readFileSync(filePath, 'utf8');
};

// Función genérica para llamar a la API de Gemini
const callGeminiAPI = async (prompt, base64Data = null, textInput = {}) => {
    const fetch = (await import('node-fetch')).default;
    const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
    const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash-latest:generateContent?key=${GEMINI_API_KEY}`;

    let fullPrompt = prompt;
    // Añadimos el texto de entrada al final del prompt para que los expertos lo analicen
    if (textInput.text) {
        fullPrompt += "\n\n# TEXTO A ANALIZAR:\n" + textInput.text;
    }
    if (textInput.visual) {
        fullPrompt += "\n\n# DESCRIPCIÓN VISUAL A CONSIDERAR:\n" + textInput.visual;
    }

    const parts = [{ text: fullPrompt }];
    if (base64Data) {
        parts.push({ inlineData: { mimeType: "image/jpeg", data: base64Data.split(',')[1] } });
    }

    const payload = { contents: [{ role: "user", parts }] };

    try {
        const response = await fetch(apiUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        if (!response.ok) {
            const errorBody = await response.text();
            console.error("Error desde la API de Gemini:", errorBody);
            throw new Error(`La API de Gemini devolvió el estado: ${response.status}`);
        }

        const data = await response.json();
        // Verificación de seguridad para evitar errores si la respuesta no es la esperada
        if (!data.candidates || !data.candidates[0] || !data.candidates[0].content || !data.candidates[0].content.parts || !data.candidates[0].content.parts[0]) {
            console.error("Respuesta inesperada de la API de Gemini:", data);
            throw new Error("Formato de respuesta de Gemini inválido.");
        }
        const text = data.candidates[0].content.parts[0].text;
        const cleanText = text.replace(/```json/g, '').replace(/```/g, '').trim();
        return JSON.parse(cleanText);

    } catch (error) {
        console.error("Error en callGeminiAPI:", error);
        return { error: error.message };
    }
};

exports.handler = async function (event, context) {
    const { base64Data } = JSON.parse(event.body);
    if (!base64Data) {
        return { statusCode: 400, body: JSON.stringify({ error: 'No se proporcionó imagen.' }) };
    }

    try {
        // --- PASO 1: AGENTE EXTRACTOR (SECUENCIAL) ---
        const extractorPrompt = readPromptFromFile('1_data_extractor.txt');
        const extractedData = await callGeminiAPI(extractorPrompt, base64Data);
        if (extractedData.error) throw new Error(`Fallo en el extractor: ${extractedData.error}`);
        
        const { raw_text, visual_description } = extractedData;

        // --- PASO 2: AGENTES EXPERTOS (EN PARALELO) ---
        const fechaFormateada = new Date().toLocaleDateString('es-ES', { day: 'numeric', month: 'long', year: 'numeric' });
        
        let datePrompt = readPromptFromFile('2_date_expert.txt').replace('${fechaFormateada}', fechaFormateada);
        const prizePrompt = readPromptFromFile('3_prize_expert.txt');
        const accountsPrompt = readPromptFromFile('4_accounts_expert.txt');

        const [dateResult, prizeResult, accountsResult] = await Promise.all([
            callGeminiAPI(datePrompt, null, { text: raw_text }),
            callGeminiAPI(prizePrompt, null, { text: raw_text, visual: visual_description }),
            callGeminiAPI(accountsPrompt, null, { text: raw_text })
        ]);

        // --- PASO 3: ENSAMBLAJE ---
        const finalResult = {
            ...dateResult,
            ...prizeResult,
            ...accountsResult
        };

        return {
            statusCode: 200,
            body: JSON.stringify(finalResult)
        };

    } catch (error) {
        console.error("Error en el orquestador:", error);
        return {
            statusCode: 500,
            body: JSON.stringify({ error: 'Error en el procesamiento del pipeline de IA.', details: error.message })
        };
    }
};
