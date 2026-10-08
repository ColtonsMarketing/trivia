require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const { OpenAI } = require('openai');

const app = express();
app.use(cors());
app.get('/', (req, res) => res.send('✅ Servidor Backend OK (Modo OpenAI Activo).'));

const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*", methods: ["GET", "POST"] } });

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

let players = [];
let gameActive = false;
let activeQuestions = [];
let currentQuestionIndex = 0;
let questionStartTime = 0;
let currentTopic = "CULTURA GENERAL";
let currentPrizes = { first: "🍕 1 PIZZA", second: "🍺 2 CERVEZAS", third: "🍟 PAPAS" };

// Función para mezclar arreglos (Evita que la respuesta correcta siempre sea la primera)
function shuffleArray(array) {
  const arr = [...array];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

io.on('connection', (socket) => {
  socket.emit('update_players', players);
  socket.emit('update_prizes', currentPrizes);
  socket.emit('update_topic', currentTopic);

  socket.on('update_prizes', (prizes) => { currentPrizes = prizes; io.emit('update_prizes', currentPrizes); });
  socket.on('update_topic', (topic) => { currentTopic = topic; io.emit('update_topic', currentTopic); });

  socket.on('join_game', (userData) => {
    const existingPlayer = players.find(p => p.name === userData.name && p.table === userData.table);
    if (existingPlayer) {
      existingPlayer.id = socket.id;
      io.emit('update_players', players);
    } else if (players.length < 20 && !gameActive) {
      players.push({ id: socket.id, ...userData, score: 0, answeredCurrentQ: false, eliminated: false });
      io.emit('update_players', players);
    }
  });

  socket.on('kick_player', (playerId) => {
    players = players.filter(p => p.id !== playerId);
    io.emit('update_players', players);
    io.to(playerId).emit('kicked');
  });

  // GENERADOR MEJORADO: FUERZA DIVERSIDAD Y MEZCLA OPCIONES
  socket.on('generate_questions', async (topic) => {
    try {
      const seed = Math.floor(Math.random() * 1000000);
      const prompt = `Genera un JSON válido con 10 preguntas NUNCA ANTES VISTAS, creativas y variadas sobre: "${topic}".
      Identificador único de sesión: ${Date.now()}-${seed}.
            
      REGLAS DE ORO:
      1. NO repitas preguntas comunes. Usa datos curiosos e interesantes.
      2. FORMATO EXACTO: El valor de "correct" DEBE ser idéntico a una de las opciones dentro de "options".
      3. CERO PREFIJOS: Sin "A)", "B:". Solo texto limpio.

      ESTRUCTURA JSON REQUERIDA:
      {
        "preguntas": [
          {
            "q": "¿Qué elemento químico tiene el símbolo Au?", 
            "options": ["Oro", "Plata", "Cobre", "Aluminio"], 
            "correct": "Oro"
          }
        ]
      }`;

      const response = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        response_format: { type: "json_object" },
        temperature: 0.8, // Mayor creatividad para evitar repeticiones
        messages: [
          { role: "system", content: "Eres un asistente de trivia que responde EXCLUSIVAMENTE en formato JSON." },
          { role: "user", content: prompt }
        ]
      });

      const parsedData = JSON.parse(response.choices[0].message.content);
      
      // Mezclamos las opciones de cada pregunta antes de enviarlas al frontend
      const preguntasProcesadas = parsedData.preguntas.slice(0, 10).map(q => ({
        ...q,
        options: shuffleArray(q.options)
      }));
      
      socket.emit('questions_ready', preguntasProcesadas);
    } catch (error) { 
      console.error("Error generando preguntas con OpenAI:", error);
      socket.emit('questions_error'); 
    }
  });

  socket.on('start_game', (questions) => {
    gameActive = true; 
    activeQuestions = questions; 
    currentQuestionIndex = 0;
    players.forEach(p => { p.score = 0; p.answeredCurrentQ = false; p.eliminated = false; });
    io.emit('game_started', questions);
    io.emit('initial_pause');
    setTimeout(() => { questionStartTime = Date.now(); io.emit('resume_game'); }, 10000);
  });

  socket.on('sync_question', (index) => {
    currentQuestionIndex = Number(index);
    
    // CORRECCIÓN RONDA 5: ELIMINACIÓN EFECTIVA
    if (currentQuestionIndex === 5) {
      players.forEach(p => { 
        if (Number(p.score) < 2000) {
          p.eliminated = true; 
        }
      });
      io.emit('update_players', players); 
      io.emit('round_pause');
      setTimeout(() => { 
        questionStartTime = Date.now(); 
        players.forEach(p => p.answeredCurrentQ = false); 
        io.emit('resume_game'); 
      }, 10000);
    } else {
      questionStartTime = Date.now(); 
      players.forEach(p => p.answeredCurrentQ = false);
    }
  });

  socket.on('submit_answer', (answerData) => {
    const player = players.find(p => p.id === socket.id || (p.name === answerData.name && p.table === answerData.table));
    const targetPlayer = player || players.find(p => p.id === socket.id);

    if (targetPlayer && activeQuestions.length > 0 && !targetPlayer.answeredCurrentQ && !targetPlayer.eliminated) {
      targetPlayer.answeredCurrentQ = true;
      const currentQ = activeQuestions[currentQuestionIndex];
      let selectedOption = typeof answerData === 'object' ? answerData.opt : answerData;
      
      const isCorrect = String(selectedOption).trim().toLowerCase() === String(currentQ.correct).trim().toLowerCase();
      const timeRemaining = Math.max(0, 10 - ((Date.now() - questionStartTime) / 1000)); 

      if (isCorrect) { 
        targetPlayer.score += 1000 + Math.round((timeRemaining / 10) * 1000); 
      } else { 
        targetPlayer.score = Math.max(0, targetPlayer.score - 300); 
      }
      
      socket.emit('answer_result', { isCorrect, selectedOption, correctOption: currentQ.correct, newScore: targetPlayer.score });
      io.emit('update_players', players);
    }
  });

  socket.on('reset_game', () => {
    players = []; gameActive = false; activeQuestions = []; currentQuestionIndex = 0;
    io.emit('update_players', players); io.emit('game_reset');
  });

  socket.on('disconnect', () => {
    if (!gameActive) {
      players = players.filter(p => p.id !== socket.id);
      io.emit('update_players', players);
    }
  });
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, '0.0.0.0', () => console.log(`✅ Servidor OK en puerto ${PORT}`));
