const fs = require('fs');
const path = require('path');

// --- Función Auxiliar para leer los prompts ---
const readPromptFromFile = (fileName) => {
    // CORRECCIÓN: Se cambió `../prompts/` por `../Prompt/` para que coincida con el nombre real de la carpeta.
    const filePath = path.join(__dirname, `../Prompt/${fileName}`);
    return fs.readFileSync(filePath, 'utf8');
};

// --- Función para llamar a la API de Gemini (robusta) ---
const callGeminiAPI = async (prompt, base64Data = null) => {
    const fetch = (await import('node-fetch')).default;
    const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
    if (!GEMINI_API_KEY) {
        throw new Error("La clave de API de Gemini no está configurada.");
    }
    const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash-latest:generateContent?key=${GEMINI_API_KEY}`;

    const parts = [{ text: prompt }];
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

        const data = await response.json();

        if (!response.ok || !data.candidates || data.candidates.length === 0) {
            console.error("Respuesta de error o inesperada de la API de Gemini:", JSON.stringify(data));
            throw new Error(`Error de la API: ${data.error?.message || 'Respuesta inválida'}`);
        }
        
        const text = data.candidates[0].content.parts[0].text;
        
        // --- Bloque de parseo seguro ---
        try {
            const cleanText = text.replace(/```json/g, '').replace(/```/g, '').trim();
            return JSON.parse(cleanText);
        } catch (parseError) {
            console.error("Error al parsear el JSON de la API de Gemini.");
            console.error("Texto recibido de la API:", text); // Esto te dirá qué está enviando la IA
            throw new Error("La respuesta de la IA no es un JSON válido.");
        }
        // --- Fin del bloque de parseo seguro ---

    } catch (error) {
        console.error("Error detallado en callGeminiAPI:", error);
        throw error;
    }
};

// --- Handler Principal de la Función ---
exports.handler = async function (event, context) {
    if (event.httpMethod !== 'POST') {
        return { statusCode: 405, body: 'Method Not Allowed' };
    }
    
    try {
        const { base64Data } = JSON.parse(event.body);
        if (!base64Data) {
            return { statusCode: 400, body: JSON.stringify({ error: 'No se proporcionó imagen.' }) };
        }

        // === PASO 1: AGENTE EXTRACTOR ===
        const extractorPrompt = readPromptFromFile('1_data_extractor.txt');
        const extractedData = await callGeminiAPI(extractorPrompt, base64Data);
        if (!extractedData || extractedData.error) throw new Error(`Fallo en el extractor: ${extractedData.error || 'No se pudo extraer texto.'}`);
        
        const { raw_text, visual_description } = extractedData;

        // === PASO 2: AGENTES EXPERTOS EN PARALELO ===
        const fechaFormateada = new Date().toLocaleDateString('es-ES', { day: 'numeric', month: 'long', year: 'numeric' });
        
        const dateInputText = `${readPromptFromFile('2_date_expert.txt').replace('${fechaFormateada}', fechaFormateada)}\n\n# TEXTO A ANALIZAR:\n${raw_text}`;
        const prizeInputText = `${readPromptFromFile('3_prize_expert.txt')}\n\n# TEXTO A ANALIZAR:\n${raw_text}\n\n# DESCRIPCIÓN VISUAL A CONSIDERAR:\n${visual_description}`;
        const accountsInputText = `${readPromptFromFile('4_accounts_expert.txt')}\n\n# TEXTO A ANALIZAR:\n${raw_text}`;

        const [dateResult, prizeResult, accountsResult] = await Promise.all([
            callGeminiAPI(dateInputText),
            callGeminiAPI(prizeInputText),
            callGeminiAPI(accountsInputText)
        ]);

        // === PASO 3: ENSAMBLAJE PARCIAL ===
        const partialResult = {
            ...dateResult,
            ...prizeResult,
            ...accountsResult
        };

        // === PASO 4: AGENTE TASADOR (CONDICIONAL) ===
        let priceResult = { price: null, winner_count: 1, appraisal_notes: "No se encontró valor explícito.", url: null };
        const priceRegex = /(\d{1,5}(?:[.,]\d{1,2})?)\s*€/;
        const priceMatch = raw_text.match(priceRegex);

        if (priceMatch) {
            priceResult.price = priceMatch[1] + '€';
            priceResult.appraisal_notes = "Valor extraído directamente del texto.";
        } else {
            // Si no hay precio en el texto, llamamos al experto tasador
            let appraiserPrompt = readPromptFromFile('5_price_appraiser.txt');
            appraiserPrompt = appraiserPrompt.replace('${prize_name}', partialResult.prize);
            appraiserPrompt = appraiserPrompt.replace('${accounts_list}', partialResult.accounts.join(', '));
            priceResult = await callGeminiAPI(appraiserPrompt);
        }

        // === PASO 5: ENSAMBLAJE FINAL ===
        const finalResult = {
            ...partialResult,
            ...priceResult
        };

        return {
            statusCode: 200,
            body: JSON.stringify(finalResult)
        };

    } catch (error) {
        console.error("Error detallado en el orquestador:", error); // MÁS DETALLE
        return {
            statusCode: 500,
            body: JSON.stringify({ 
                error: 'Error en el procesamiento del pipeline de IA.', 
                details: error.message,
                stack: error.stack // Incluir el stack trace ayuda a depurar
            })
        };
    }
};            console.error("Respuesta de error o inesperada de la API de Gemini:", JSON.stringify(data));
            throw new Error(`Error de la API: ${data.error?.message || 'Respuesta inválida'}`);
        }
        
        const text = data.candidates[0].content.parts[0].text;
        const cleanText = text.replace(/```json/g, '').replace(/```/g, '').trim();
        return JSON.parse(cleanText);

    } catch (error) {
        console.error("Error detallado en callGeminiAPI:", error);
        throw error;
    }
};

// --- Handler Principal de la Función ---
exports.handler = async function (event, context) {
    if (event.httpMethod !== 'POST') {
        return { statusCode: 405, body: 'Method Not Allowed' };
    }
    
    try {
        const { base64Data } = JSON.parse(event.body);
        if (!base64Data) {
            return { statusCode: 400, body: JSON.stringify({ error: 'No se proporcionó imagen.' }) };
        }

        // === PASO 1: AGENTE EXTRACTOR ===
        const extractorPrompt = readPromptFromFile('1_data_extractor.txt');
        const extractedData = await callGeminiAPI(extractorPrompt, base64Data);
        if (!extractedData || extractedData.error) throw new Error(`Fallo en el extractor: ${extractedData.error || 'No se pudo extraer texto.'}`);
        
        const { raw_text, visual_description } = extractedData;

        // === PASO 2: AGENTES EXPERTOS EN PARALELO ===
        const fechaFormateada = new Date().toLocaleDateString('es-ES', { day: 'numeric', month: 'long', year: 'numeric' });
        
        const dateInputText = `${readPromptFromFile('2_date_expert.txt').replace('${fechaFormateada}', fechaFormateada)}\n\n# TEXTO A ANALIZAR:\n${raw_text}`;
        const prizeInputText = `${readPromptFromFile('3_prize_expert.txt')}\n\n# TEXTO A ANALIZAR:\n${raw_text}\n\n# DESCRIPCIÓN VISUAL A CONSIDERAR:\n${visual_description}`;
        const accountsInputText = `${readPromptFromFile('4_accounts_expert.txt')}\n\n# TEXTO A ANALIZAR:\n${raw_text}`;

        const [dateResult, prizeResult, accountsResult] = await Promise.all([
            callGeminiAPI(dateInputText),
            callGeminiAPI(prizeInputText),
            callGeminiAPI(accountsInputText)
        ]);

        // === PASO 3: ENSAMBLAJE PARCIAL ===
        const partialResult = {
            ...dateResult,
            ...prizeResult,
            ...accountsResult
        };

        // === PASO 4: AGENTE TASADOR (CONDICIONAL) ===
        let priceResult = { price: null, winner_count: 1, appraisal_notes: "No se encontró valor explícito.", url: null };
        const priceRegex = /(\d{1,5}(?:[.,]\d{1,2})?)\s*€/;
        const priceMatch = raw_text.match(priceRegex);

        if (priceMatch) {
            priceResult.price = priceMatch[1] + '€';
            priceResult.appraisal_notes = "Valor extraído directamente del texto.";
        } else {
            // Si no hay precio en el texto, llamamos al experto tasador
            let appraiserPrompt = readPromptFromFile('5_price_appraiser.txt');
            appraiserPrompt = appraiserPrompt.replace('${prize_name}', partialResult.prize);
            appraiserPrompt = appraiserPrompt.replace('${accounts_list}', partialResult.accounts.join(', '));
            priceResult = await callGeminiAPI(appraiserPrompt);
        }

        // === PASO 5: ENSAMBLAJE FINAL ===
        const finalResult = {
            ...partialResult,
            ...priceResult
        };

        return {
            statusCode: 200,
            body: JSON.stringify(finalResult)
        };

    } catch (error) {
        console.error("Error en el orquestador:", error.toString());
        return {
            statusCode: 500,
            body: JSON.stringify({ error: 'Error en el procesamiento del pipeline de IA.', details: error.message })
        };
    }
};

// CORRECCIÓN: Se eliminó todo el código duplicado que había a partir de aquí.            throw new Error(`Error de la API: ${data.error?.message || 'Respuesta inválida'}`);
        }
        
        const text = data.candidates[0].content.parts[0].text;
        const cleanText = text.replace(/```json/g, '').replace(/```/g, '').trim();
        return JSON.parse(cleanText);

    } catch (error) {
        console.error("Error detallado en callGeminiAPI:", error);
        throw error;
    }
};

// --- Handler Principal de la Función ---
exports.handler = async function (event, context) {
    if (event.httpMethod !== 'POST') {
        return { statusCode: 405, body: 'Method Not Allowed' };
    }
    
    try {
        const { base64Data } = JSON.parse(event.body);
        if (!base64Data) {
            return { statusCode: 400, body: JSON.stringify({ error: 'No se proporcionó imagen.' }) };
        }

        // === PASO 1: AGENTE EXTRACTOR ===
        const extractorPrompt = readPromptFromFile('1_data_extractor.txt');
        const extractedData = await callGeminiAPI(extractorPrompt, base64Data);
        if (!extractedData || extractedData.error) throw new Error(`Fallo en el extractor: ${extractedData.error || 'No se pudo extraer texto.'}`);
        
        const { raw_text, visual_description } = extractedData;

        // === PASO 2: AGENTES EXPERTOS EN PARALELO ===
        const fechaFormateada = new Date().toLocaleDateString('es-ES', { day: 'numeric', month: 'long', year: 'numeric' });
        
        const dateInputText = `${readPromptFromFile('2_date_expert.txt').replace('${fechaFormateada}', fechaFormateada)}\n\n# TEXTO A ANALIZAR:\n${raw_text}`;
        const prizeInputText = `${readPromptFromFile('3_prize_expert.txt')}\n\n# TEXTO A ANALIZAR:\n${raw_text}\n\n# DESCRIPCIÓN VISUAL A CONSIDERAR:\n${visual_description}`;
        const accountsInputText = `${readPromptFromFile('4_accounts_expert.txt')}\n\n# TEXTO A ANALIZAR:\n${raw_text}`;

        const [dateResult, prizeResult, accountsResult] = await Promise.all([
            callGeminiAPI(dateInputText),
            callGeminiAPI(prizeInputText),
            callGeminiAPI(accountsInputText)
        ]);

        // === PASO 3: ENSAMBLAJE PARCIAL ===
        const partialResult = {
            ...dateResult,
            ...prizeResult,
            ...accountsResult
        };

        // === PASO 4: AGENTE TASADOR (CONDICIONAL) ===
        let priceResult = { price: null, winner_count: 1, appraisal_notes: "No se encontró valor explícito.", url: null };
        const priceRegex = /(\d{1,5}(?:[.,]\d{1,2})?)\s*€/;
        const priceMatch = raw_text.match(priceRegex);

        if (priceMatch) {
            priceResult.price = priceMatch[1] + '€';
            priceResult.appraisal_notes = "Valor extraído directamente del texto.";
        } else {
            // Si no hay precio en el texto, llamamos al experto tasador
            let appraiserPrompt = readPromptFromFile('5_price_appraiser.txt');
            appraiserPrompt = appraiserPrompt.replace('${prize_name}', partialResult.prize);
            appraiserPrompt = appraiserPrompt.replace('${accounts_list}', partialResult.accounts.join(', '));
            priceResult = await callGeminiAPI(appraiserPrompt);
        }

        // === PASO 5: ENSAMBLAJE FINAL ===
        const finalResult = {
            ...partialResult,
            ...priceResult
        };

        return {
            statusCode: 200,
            body: JSON.stringify(finalResult)
        };

    } catch (error) {
        console.error("Error en el orquestador:", error.toString());
        return {
            statusCode: 500,
            body: JSON.stringify({ error: 'Error en el procesamiento del pipeline de IA.', details: error.message })
        };
    }
};        // === PASO 2: AGENTES EXPERTOS EN PARALELO ===
        const fechaFormateada = new Date().toLocaleDateString('es-ES', { day: 'numeric', month: 'long', year: 'numeric' });
        
        const dateInputText = `${readPromptFromFile('2_date_expert.txt').replace('${fechaFormateada}', fechaFormateada)}\n\n# TEXTO A ANALIZAR:\n${raw_text}`;
        const prizeInputText = `${readPromptFromFile('3_prize_expert.txt')}\n\n# TEXTO A ANALIZAR:\n${raw_text}\n\n# DESCRIPCIÓN VISUAL A CONSIDERAR:\n${visual_description}`;
        const accountsInputText = `${readPromptFromFile('4_accounts_expert.txt')}\n\n# TEXTO A ANALIZAR:\n${raw_text}`;

        const [dateResult, prizeResult, accountsResult] = await Promise.all([
            callGeminiAPI(dateInputText),
            callGeminiAPI(prizeInputText),
            callGeminiAPI(accountsInputText)
        ]);

        // === PASO 3: ENSAMBLAJE PARCIAL ===
        const partialResult = {
            ...dateResult,
            ...prizeResult,
            ...accountsResult
        };

        // === PASO 4: AGENTE TASADOR (CONDICIONAL) ===
        let priceResult = { price: null, winner_count: 1, appraisal_notes: "No se encontró valor explícito.", url: null };
        const priceRegex = /(\d{1,5}(?:[.,]\d{1,2})?)\s*€/;
        const priceMatch = raw_text.match(priceRegex);

        if (priceMatch) {
            priceResult.price = priceMatch[1] + '€';
            priceResult.appraisal_notes = "Valor extraído directamente del texto.";
        } else {
            // Si no hay precio en el texto, llamamos al experto tasador
            let appraiserPrompt = readPromptFromFile('5_price_appraiser.txt');
            appraiserPrompt = appraiserPrompt.replace('${prize_name}', partialResult.prize);
            appraiserPrompt = appraiserPrompt.replace('${accounts_list}', partialResult.accounts.join(', '));
            priceResult = await callGeminiAPI(appraiserPrompt);
        }

        // === PASO 5: ENSAMBLAJE FINAL ===
        const finalResult = {
            ...partialResult,
            ...priceResult
        };

        return {
            statusCode: 200,
            body: JSON.stringify(finalResult)
        };

    } catch (error) {
        console.error("Error en el orquestador:", error.toString());
        return {
            statusCode: 500,
            body: JSON.stringify({ error: 'Error en el procesamiento del pipeline de IA.', details: error.message })
        };
filePath            body: JSON.stringify(finalResult)
        };

    } catch (error) {
        console.error("Error en el orquestador:", error);
        return {
            statusCode: 500,
            body: JSON.stringify({ error: 'Error en el procesamiento del pipeline de IA.', details: error.message })
        };
    }
};
