'use strict';

// worker_threads: bot hisob-kitobi asosiy event loop'ni bloklamasligi uchun shu yerda bajariladi (chessBot.js havolasi orqali)
const { parentPort } = require('worker_threads');
const { searchBestMove } = require('./chessBot');

parentPort.on('message', ({ id, fen, level }) => {
  try {
    parentPort.postMessage({ id, move: searchBestMove(fen, level) });
  } catch (err) {
    parentPort.postMessage({ id, error: String((err && err.message) || err) });
  }
});