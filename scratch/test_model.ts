import { GoogleGenAI } from "@google/genai";
import dotenv from "dotenv";
dotenv.config();

const apiKey = process.env.GOOGLE_API_KEY;
console.log("Using API Key:", apiKey);
const client = new GoogleGenAI({ apiKey });

async function testConnect(model: string) {
  console.log(`Connecting to ${model}...`);
  return new Promise<void>((resolve) => {
    let resolved = false;
    const done = () => {
      if (!resolved) {
        resolved = true;
        resolve();
      }
    };
    
    (client as any).live.connect({
      model,
      callbacks: {
        onopen: function(this: any) {
          console.log(`Successfully connected to ${model}!`);
          try {
            this.close();
          } catch {}
          done();
        },
        onerror: (err: any) => {
          console.error(`Error connecting to ${model}:`, err.message || err);
          done();
        },
        onclose: () => {
          console.log(`Closed connection to ${model}`);
          done();
        }
      }
    }).then((session: any) => {
      setTimeout(() => {
        try { session.close(); } catch {}
        done();
      }, 5000);
    }).catch((err: any) => {
      console.error(`Failed to start connection to ${model}:`, err.message || err);
      done();
    });
  });
}

async function run() {
  await testConnect("gemini-3.1-flash-live-preview");
}

run();
