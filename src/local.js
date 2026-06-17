import 'dotenv/config';
import app from './index.js';

const port = Number(process.env.PORT || 8787);

app.listen(port, () => {
  console.log(`XHS HTML downloader: http://127.0.0.1:${port}`);
});
