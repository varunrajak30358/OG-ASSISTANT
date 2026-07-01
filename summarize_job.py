import torch
from transformers import BartTokenizer, BartForConditionalGeneration
from datasets import load_dataset
from rouge_score import rouge_scorer

# 1. Load the model and tokenizer (BART as suggested by the paper)
model_name = 'facebook/bart-large-cnn'
tokenizer = BartTokenizer.from_pretrained(model_name)
model = BartForConditionalGeneration.from_pretrained(model_name)

# Use GPU if available
device = 'cuda' if torch.cuda.is_available() else 'cpu'
model.to(device)

# 2. Example Job Posting text (you should load your dataset here)
job_posting = """
Senior Machine Learning Engineer
Responsibilities:
- Design and build scalable machine learning models for large datasets.
- Collaborate with product and data science teams to define feature requirements.
- Deploy models to production environments and monitor their performance.
- Mentor junior engineers and contribute to code reviews.
Qualifications:
- Masters or PhD in Computer Science or related field.
- 5+ years of experience with Python, PyTorch/TensorFlow, and cloud platforms.
- Proven track record of deploying systems into production.
"""

# 3. Generate Summary
inputs = tokenizer([job_posting], max_length=1024, return_tensors='pt', truncation=True)
inputs = inputs.to(device)

summary_ids = model.generate(inputs['input_ids'], num_beams=4, max_length=150, early_stopping=True)
generated_summary = tokenizer.decode(summary_ids[0], skip_special_tokens=True)

print(f"--- Job Posting ---\n{job_posting}")
print(f"--- Generated Summary ---\n{generated_summary}")

# 4. Evaluate (Dummy evaluation, need reference summaries for real ROUGE score)
reference_summary = "We are seeking a Senior Machine Learning Engineer with 5+ experience, proficient in Python and PyTorch/TensorFlow, to design, build, and deploy models, monitor performance, and mentor juniors."

scorer = rouge_scorer.RougeScorer(['rougeL'], use_stemmer=True)
scores = scorer.score(reference_summary, generated_summary)
print(f"--- ROUGE Scores ---\n{scores}")
