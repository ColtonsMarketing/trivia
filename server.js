require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const { OpenAI } = require('openai');

const app = express();
app.use(cors());

// RUTA CLAVE PARA RENDER: Confirmación de servicio activo
app.get('/', (req, res) => {
  res.send('✅ Servidor Backend de Coltons funcionando correctamente.');
});

const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*", methods: ["GET", "POST"] } });

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

let players = [];
let gameActive = false;
let activeQuestions = [];
let currentQuestionIndex = 0;
let questionStartTime = 0;
let currentPrize = "🍕 ¡1 PIZZA GRATIS!"; 

io.on('connection', (socket) => {
  console.log(`🔌 Un usuario se ha conectado: ${socket.id}`);
  
  socket.emit('update_players', players);
  socket.emit('update_prize', currentPrize);

  // CORRECCIÓN PREMIO: Escucha tanto 'set_prize' como 'update_prize' para evitar desincronización
  const handlePrizeUpdate = (newPrize) => {
    currentPrize = newPrize;
    io.emit('update_prize', currentPrize);
    console.log(`🎁 Premio actualizado: ${currentPrize}`);
  };

  socket.on('set_prize', handlePrizeUpdate);
  socket.on('update_prize', handlePrizeUpdate);

  socket.on('join_game', (userData) => {
    if (players.length < 20 && !gameActive) {
      players.push({ id: socket.id, ...userData, score: 0, answeredCurrentQ: false });
      io.emit('update_players', players);
    }
  });

  socket.on('generate_questions', async (topic) => {
    try {
      console.log(`🧠 Generando 5 preguntas sobre: ${topic}...`);
      const response = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        response_format: { type: "json_object" },
        messages: [
          { 
            role: "system", 
            content: `Eres el motor de trivia de un casino. TU ÚNICA TAREA ES DEVOLVER UN JSON CON EXACTAMENTE 5 PREGUNTAS. NUNCA DEVUELVAS 3 PREGUNTAS. La dificultad debe ser extrema (detalles curiosos, fechas, datos raros). Las 3 opciones incorrectas deben parecer muy reales.
            Usa exactamente este formato:
            {
              "preguntas": [
                {"q": "Pregunta 1", "options": ["A", "B", "C", "D"], "correct": "A"},
                {"q": "Pregunta 2", "options": ["A", "B", "C", "D"], "correct": "B"},
                {"q": "Pregunta 3", "options": ["A", "B", "C", "D"], "correct": "C"},
                {"q": "Pregunta 4", "options": ["A", "B", "C", "D"], "correct": "D"},
                {"q": "Pregunta 5", "options": ["A", "B", "C", "D"], "correct": "A"}
              ]
            }`
          },
          {
            role: "user",
            content: `Genera el JSON con las 5 preguntas difíciles sobre el tema: "${topic}".`
          }
        ]
      });
      
      const result = JSON.parse(response.choices[0].message.content);
      console.log(`🤖 OpenAI respondió con: ${result.preguntas.length} preguntas.`);
      socket.emit('questions_ready', result.preguntas);
    } catch (error) {
      console.error("❌ Error con OpenAI:", error);
      socket.emit('questions_error');
    }
  });

  socket.on('start_game', (questions) => {
    gameActive = true;
    activeQuestions = questions;
    currentQuestionIndex = 0;
    questionStartTime = Date.now();
    
    players.forEach(p => {
      p.score = 0;
      p.answeredCurrentQ = false;
    });

    io.emit('game_started', questions);
  });

  socket.on('sync_question', (index) => {
    currentQuestionIndex = index;
    questionStartTime = Date.now(); 
    players.forEach(p => p.answeredCurrentQ = false);
  });

  // CORRECCIÓN PUNTOS: Acepta tanto el índice numérico (0, 1, 2) como el texto directo
  socket.on('submit_answer', (answerData) => {
    const player = players.find(p => p.id === socket.id);
    if (player && activeQuestions.length > 0 && !player.answeredCurrentQ) {
      player.answeredCurrentQ = true;
      const currentQ = activeQuestions[currentQuestionIndex];

      let selectedOption;
      if (typeof answerData === 'number') {
        selectedOption = currentQ.options[answerData];
      } else {
        selectedOption = answerData;
      }

      const timeTaken = (Date.now() - questionStartTime) / 1000; 
      const timeRemaining = Math.max(0, 10 - timeTaken); 

      if (selectedOption === currentQ.correct) {
        const speedBonus = Math.round((timeRemaining / 10) * 1000);
        const totalEarned = 1000 + speedBonus;
        player.score += totalEarned;
        console.log(`✅ ${player.name} acertó ("${selectedOption}") en ${timeTaken.toFixed(1)}s (+${totalEarned} pts)`);
      } else {
        player.score = Math.max(0, player.score - 300);
        console.log(`❌ ${player.name} falló con "${selectedOption}" (Correcta: "${currentQ.correct}") (-300 pts)`);
      }
      
      io.emit('update_players', players);
    }
  });

  socket.on('reset_game', () => {
    players = [];
    gameActive = false;
    activeQuestions = [];
    currentQuestionIndex = 0;
    io.emit('update_players', players);
    io.emit('game_reset');
    console.log('🔄 Partida reiniciada.');
  });

  socket.on('disconnect', () => {
    players = players.filter(p => p.id !== socket.id);
    io.emit('update_players', players);
  });
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`✅ Servidor de Coltons corriendo en el puerto ${PORT}`);
});
