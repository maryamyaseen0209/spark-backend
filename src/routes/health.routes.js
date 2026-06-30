import { Router } from 'express';

const router = Router();

router.get('/', (req, res) => {
  res.json({ success: true, service: 'Study SparkAI API', phase: 1, status: 'ok', timestamp: new Date().toISOString() });
});

export default router;
