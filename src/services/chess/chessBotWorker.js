'use strict';

// worker_threads: bot hisob-kitobi asosiy event loop'ni bloklamasligi uchun shu yerda bajariladi (chessBot.js havolasi orqali)
const { parentPort } = require('worker_threads');
const { searchBest } = require('./chessBot');

// position — shahmatda FEN (xabarda "fen" nomi eskidan qolgan), shashkada pozitsiya matni. gameType bo'lmasa — shahmat.
parentPort.on('message', ({ id, fen, level, gameType }) => {
  try {
    parentPort.postMessage({ id, move: searchBest(fen, level, gameType || 'CHESS') });
  } catch (err) {
    parentPort.postMessage({ id, error: String((err && err.message) || err) });
  }
});