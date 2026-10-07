<div align="center">

## Project structure

```
creditai/
├── frontend/
│   ├── index.html
│   ├── style.css
│   └── script.js
├── backend/
│   └── main.py
├── credit_risk_model.pkl     # trained model (repo root)
├── best_threshold.pkl        # saved decision threshold (repo root)
├── requirements.txt
├── runtime.txt
└── README.md
```

## Run locally

```bash
python -m venv venv && source venv/bin/activate   # Windows: venv\Scripts\activate
pip install -r requirements.txt
uvicorn backend.main:app --reload --port 8000     # run from the repo root
```

Open http://127.0.0.1:8000/app/

The frontend also works from VS Code Live Server; it then calls `http://127.0.0.1:8000` automatically.

## Deploy on Render

1. Push the repo to GitHub with both `.pkl` files in the root.
2. Render: **New → Web Service** and select the repo.
3. Build command: `pip install -r requirements.txt`
4. Start command: `uvicorn backend.main:app --host 0.0.0.0 --port $PORT`
5. Open `https://YOUR-SERVICE.onrender.com/app/`

No environment variables are required. The model is only loaded on Render, never trained.

To host the frontend separately, deploy `frontend/` as a Static Site and add this before `script.js` in `index.html`:

```html
<script>window.CREDITAI_API_BASE = "https://YOUR-BACKEND.onrender.com";</script>
```

## Configuration notes

- **CORS:** `allow_origins=["*"]` is fine for a demo. For production, use your frontend URL, e.g. `["https://your-frontend.onrender.com"]`, and set `allow_credentials=False`.
- **Python version:** `runtime.txt` pins 3.11.9. Match the Python and scikit-learn versions the model was trained with, and pin them in `requirements.txt`.
- **Free-tier cold starts:** Render free services sleep when idle, so the first request can take a while.

## Limitations and disclaimer

This system provides machine-learning-based risk estimates for demonstration and decision-support purposes. Counterfactual and stress-test results represent hypothetical model scenarios and should not be interpreted as causal predictions or actual lending decisions.

These scenarios are hypothetical model-based simulations and should not be interpreted as causal effects, financial advice, or guaranteed outcomes.
