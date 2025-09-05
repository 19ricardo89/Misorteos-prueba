// netlify/functions/search.js
exports.handler = async function (event, context) {
    const fetch = (await import('node-fetch')).default;
    const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
    const { query, accounts } = JSON.parse(event.body);

    if (!query) {
        // Devuelve una respuesta de error por defecto si no hay consulta
        return {
            statusCode: 400,
            body: JSON.stringify({ value: '1', url: null, error: 'Falta la consulta (query).' })
        };
    }

    const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash-latest:generateContent?key=${GEMINI_API_KEY}`;

    // --- INICIO DEL PROMPT "TASADOR" v4 (Más fiable) ---
    const prompt = `
        Eres un asistente de IA especializado en encontrar el valor de mercado de productos.
        Tu única tarea es analizar el producto y devolver un objeto JSON con el valor estimado.

        **PRODUCTO A VALORAR:**
        - Nombre: "${query}"
        - Marcas/Cuentas asociadas: ${accounts.join(', ')}

        **FORMATO DE SALIDA OBLIGATORIO:**
        Tu respuesta DEBE SER SOLAMENTE un objeto JSON válido con esta estructura, sin texto adicional:
        {
          "value": "string",
          "url": "string"
        }

        **REGLAS PARA EL CAMPO "value":**
        1.  El valor debe ser un string que contenga **únicamente números** (ej: "150", "49.99").
        2.  Primero, intenta encontrar el precio exacto en Google o Amazon.
        3.  Si no encuentras el precio exacto, **DEBES ESTIMAR** un valor medio razonable basándote en productos similares.
        4.  Es **MEJOR** una buena estimación que no devolver nada. **NUNCA** uses "No encontrado" o "0".

        **REGLAS PARA EL CAMPO "url":**
        1.  Debe ser el enlace más relevante que hayas usado para tu búsqueda o estimación.
        2.  Si no encuentras un enlace útil, devuelve null.
    `;
    // --- FIN DEL PROMPT ---

    try {
        const geminiResponse = await fetch(apiUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] })
        });

        if (!geminiResponse.ok) {
            throw new Error(`La API de Gemini devolvió el estado: ${geminiResponse.status}`);
        }

        const data = await geminiResponse.json();

        // Comprueba si la respuesta tiene la estructura esperada y extrae el JSON
        if (data.candidates && data.candidates[0]?.content?.parts[0]?.text) {
            const text = data.candidates[0].content.parts[0].text;
            const jsonMatch = text.match(/\{[\s\S]*\}/); // Extracción robusta del JSON
            if (jsonMatch) {
                return {
                    statusCode: 200,
                    headers: { 'Content-Type': 'application/json' },
                    body: jsonMatch[0] 
                };
            }
        }
        
        // Si no se encuentra un JSON válido en la respuesta
        throw new Error("La respuesta de la IA no contenía un JSON válido.");

    } catch (error) {
        console.error("Error en la función search.js:", error);
        // Devuelve un valor por defecto en caso de error para no romper el frontend
        return {
            statusCode: 500,
            body: JSON.stringify({ value: '1', url: null, error: error.message })
        };
    }
};