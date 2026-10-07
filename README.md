<div align="center">

# CreditAI

**Know the risk before the loan is made.**

A machine-learning credit risk app that estimates loan default probability, then shows how that estimate moves under what-if changes and financial stress.

`Python` · `FastAPI` · `scikit-learn` · `pandas` · `Vanilla JS` · `Render`

</div>

> **Demo project.** CreditAI is not a bank, lender or credit bureau. Results are model estimates for demonstration and decision-support only.

---

## Table of contents

1. [The problem](#the-problem)
2. [What the app does](#what-the-app-does)
3. [How it works](#how-it-works)
4. [Dashboard sections explained](#dashboard-sections-explained)
5. [Scenario definitions](#scenario-definitions)
6. [Input fields](#input-fields)
7. [API](#api)
8. [Project structure](#project-structure)
9. [Run locally](#run-locally)
10. [Deploy on Render](#deploy-on-render)
11. [Configuration notes](#configuration-notes)
12. [Limitations and disclaimer](#limitations-and-disclaimer)

---

## The problem

A lender deciding on a loan needs to know how likely the borrower is to default. A single probability is useful, but it leaves three questions open:

1. **Is this applicant a default risk, and how confident is the model?** (current risk)
2. **Which details of the profile push the risk up or down?** (what-if analysis)
3. **Would the applicant still be safe if their finances got worse?** (stress testing)

CreditAI answers all three from one form, using one trained model.

## What the app does

- Scores an applicant with a pre-trained ML classifier and compares the default probability with a saved decision threshold.
- Re-scores the same applicant under 8 hypothetical what-if changes.
- Re-scores them under 4 adverse stress scenarios plus 1 combined stress scenario.
- Summarises everything in one decision dashboard.
- Calculates loan-to-income automatically and warns when the profile looks unusual.

The frontend only collects inputs and displays results. **All risk calculations happen in the backend**; nothing is computed or invented in JavaScript.

## How it works

```
Browser (HTML/CSS/JS)  ──POST /risk-analysis──▶  FastAPI  ──▶  credit_risk_model.pkl
        ▲                                           │          best_threshold.pkl
        └──────────  JSON: prediction, what-if,  ◀──┘
                     stress tests, decision summary
```

1. The user fills in 11 applicant, loan and credit-history fields.
2. The backend recalculates `loan_percent_income = loan_amnt / person_income` so it can never be inconsistent.
3. The model returns the default probability for the applicant.
4. For every scenario the backend changes the relevant fields, **recalculates the loan-to-income ratio again**, and re-scores with the same model.
5. The frontend renders the returned values as a gauge, bars and cards.

## Dashboard sections explained

| Section | What it shows | Question it answers |
|---|---|---|
| **Current Risk** | Animated gauge with the default probability, the decision threshold marker, the risk band and the predicted class | How risky is this applicant right now? |
| **Applicant Summary** | Income, loan amount, rate, loan-to-income (×), grade, intent, employment, credit history, previous default | Which profile was scored? |
| **What-If Risk Analysis** | Eight single-change scenarios with the resulting risk and the change in percentage points (pp). Highlights the largest increase and largest reduction | Which changes move the model's estimate most? |
| **Financial Stress Testing** | Four adverse scenarios as bars against the threshold line, plus a **Combined Stress Scenario** card | Does the estimate stay acceptable if finances worsen? |
| **Risk Decision Dashboard** | Current decision, risk band, what drives the risk, and stress exposure in one view | What is the overall picture? |

**Risk band vs predicted class.** These are separate:

- *Risk band* comes from the probability alone: below 10% Low, below 30% Moderate, below 60% High, otherwise Very High.
- *Predicted class* comes from the saved threshold: probability at or above the threshold is **Predicted Default**, otherwise **Predicted Non-Default**.

So an applicant can sit in the High Risk band and still be Predicted Non-Default if the threshold is higher.

## Scenario definitions

**What-If (counterfactual), one change at a time**

| Scenario | Change |
|---|---|
| Loan Amount +10% / +20% | `loan_amnt` × 1.10 / × 1.20 |
| Income +10% / +20% | `person_income` × 1.10 / × 1.20 |
| Interest Rate +1% / +2% | `loan_int_rate` + 1 / + 2 |
| Employment −1 / −2 years | `person_emp_length` − 1 / − 2 (minimum 0) |

**Stress tests**

| Scenario | Change |
|---|---|
| Income −10% / −20% | `person_income` × 0.90 / × 0.80 |
| Interest Rate +2% | `loan_int_rate` + 2 |
| Loan Amount +10% | `loan_amnt` × 1.10 |
| **Combined stress** | Income −20%, interest rate +2, loan amount +10% together |

These are model-based what-ifs. They do **not** claim that a change causes default.

## Input fields

| Field | Description |
|---|---|
| `person_age` | Age in years |
| `person_income` | Annual income (must be > 0) |
| `person_home_ownership` | RENT, OWN, MORTGAGE, OTHER |
| `person_emp_length` | Years of employment |
| `loan_intent` | PERSONAL, EDUCATION, MEDICAL, VENTURE, HOMEIMPROVEMENT, DEBTCONSOLIDATION |
| `loan_grade` | A to G |
| `loan_amnt` | Loan amount |
| `loan_int_rate` | Interest rate (%) |
| `loan_percent_income` | **Automatic**: `loan_amnt / person_income`, shown as e.g. `0.22×`; read-only |
| `cb_person_default_on_file` | Y or N |
| `cb_person_cred_hist_length` | Credit history length in years |

If the loan-to-income ratio exceeds 1×, the UI warns that the profile may be outside typical training patterns and results may be less reliable.

## API

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/risk-analysis` | Full analysis (used by the dashboard) |
| `POST` | `/predict` | Basic prediction only |
| `GET` | `/` | Health message |
| `GET` | `/app/` | Serves the frontend |

`/risk-analysis` returns `prediction`, `counterfactual`, `stress_testing` and `decision_summary`. Scenario entries contain `scenario`, `risk` (%, 2 decimals) and `risk_change` (percentage points, 4 decimals).

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
