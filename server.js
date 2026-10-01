require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const { OpenAI } = require('openai');

const app = express();
app.use(cors());

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
  console.log(`🔌 Usuario conectado: ${socket.id}`);
  
  socket.emit('update_players', players);
  socket.emit('update_prize', currentPrize);

  const handlePrizeUpdate = (newPrize) => {
    currentPrize = newPrize;
    io.emit('update_prize', currentPrize);
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
      const response = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        response_format: { type: "json_object" },
        messages: [
          { 
            role: "system", 
            content: `Eres el motor de trivia de un casino. DEVUELVE UN JSON CON EXACTAMENTE 5 PREGUNTAS. Dificultad alta.
            Formato:
            {
              "preguntas": [
                {"q": "Pregunta 1", "options": ["A", "B", "C", "D"], "correct": "A"}
              ]
            }`
          },
          { role: "user", content: `Preguntas sobre: "${topic}".` }
        ]
      });
      
      const result = JSON.parse(response.choices[0].message.content);
      socket.emit('questions_ready', result.preguntas);
    } catch (error) {
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

  // EVALUACIÓN DE RESPUESTA Y PUNTOS
  socket.on('submit_answer', (answerData) => {
    const player = players.find(p => p.id === socket.id);
    if (player && activeQuestions.length > 0 && !player.answeredCurrentQ) {
      player.answeredCurrentQ = true;
      const currentQ = activeQuestions[currentQuestionIndex];

      let selectedOption = typeof answerData === 'number' ? currentQ.options[answerData] : answerData;

      // Comparación limpia (sin importar espacios ni mayúsculas/minúsculas)
      const cleanSelected = String(selectedOption).trim().toLowerCase();
      const cleanCorrect = String(currentQ.correct).trim().toLowerCase();
      const isCorrect = cleanSelected === cleanCorrect;

      const timeTaken = (Date.now() - questionStartTime) / 1000; 
      const timeRemaining = Math.max(0, 10 - timeTaken); 

      if (isCorrect) {
        const speedBonus = Math.round((timeRemaining / 10) * 1000);
        const totalEarned = 1000 + speedBonus;
        player.score += totalEarned;
      } else {
        player.score = Math.max(0, player.score - 300);
      }
      
      // Enviamos el resultado individual al jugador para que pinte su botón verde/rojo
      socket.emit('answer_result', {
        isCorrect,
        selectedOption,
        correctOption: currentQ.correct,
        newScore: player.score
      });

      // Transmitimos a todos la lista actualizada de jugadores con sus nuevos puntos
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
  });

  socket.on('disconnect', () => {
    players = players.filter(p => p.id !== socket.id);
    io.emit('update_players', players);
  });
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, '0.0.0.0');
