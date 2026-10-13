// Vercel Serverless Function — all /api/* requests are rewritten here (see vercel.json).
// The real code is the backend bundled by `npm run build:vercel`.
export { default } from '../backend/dist/vercel.js'
