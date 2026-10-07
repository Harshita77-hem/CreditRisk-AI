from pathlib import Path
from contextlib import asynccontextmanager

import joblib
import pandas as pd
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

# =========================================================
# MODEL STORAGE + LOADING (unchanged)
# =========================================================

ml_model = {}


@asynccontextmanager
async def lifespan(app: FastAPI):
    ml_model["model"] = joblib.load("credit_risk_model.pkl")
    ml_model["threshold"] = joblib.load("best_threshold.pkl")
    yield
    ml_model.clear()


app = FastAPI(lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# =========================================================
# INPUT DATA
# person_income must be > 0 because loan_percent_income divides by it.
# =========================================================

class LoanApplication(BaseModel):
    person_age: int
    person_income: float = Field(gt=0)
    person_home_ownership: str
    person_emp_length: float
    loan_intent: str
    loan_grade: str
    loan_amnt: float
    loan_int_rate: float
    loan_percent_income: float
    cb_person_default_on_file: str
    cb_person_cred_hist_length: int


# =========================================================
# HELPERS
# =========================================================

def get_risk_level(probability):
    if probability < 0.10:
        return "Low Risk"
    elif probability < 0.30:
        return "Moderate Risk"
    elif probability < 0.60:
        return "High Risk"
    else:
        return "Very High Risk"


def sync_ratio(df):
    """loan_percent_income = loan_amnt / person_income, always recalculated."""
    df["loan_percent_income"] = df["loan_amnt"] / df["person_income"]
    return df


def build_applicant(data: LoanApplication):
    return sync_ratio(pd.DataFrame([data.dict()]))


def probability_of(df):
    """Recalculate the ratio, then score. Used for every scenario."""
    return ml_model["model"].predict_proba(sync_ratio(df))[0, 1]


def scenario_result(name, probability, current_probability):
    return {
        "scenario": name,
        "risk": round(float(probability * 100), 2),
        "risk_change": round(float((probability - current_probability) * 100), 4),
    }


# =========================================================
# ROUTES
# =========================================================

@app.get("/")
def greet():
    return {"message": "Credit Risk API is running"}


@app.post("/predict")
def predict(data: LoanApplication):
    input_df = build_applicant(data)
    probability = ml_model["model"].predict_proba(input_df)[0, 1]
    threshold = ml_model["threshold"]
    prediction = int(probability >= threshold)

    return {
        "default_probability": float(probability),
        "default_prediction": prediction,
        "threshold": float(threshold),
        "Result": get_risk_level(probability),
    }


@app.post("/risk-analysis")
def risk_analysis(data: LoanApplication):

    applicant = build_applicant(data)

    current_probability = ml_model["model"].predict_proba(applicant)[0, 1]
    threshold = ml_model["threshold"]
    prediction = int(current_probability >= threshold)
    risk_level = get_risk_level(current_probability)

    # -----------------------------------------------------
    # COUNTERFACTUAL ANALYSIS (scenario definitions unchanged)
    # -----------------------------------------------------

    counterfactual_scenarios = {
        "Loan Amount +10%": {"loan_amnt": applicant["loan_amnt"].iloc[0] * 1.10},
        "Loan Amount +20%": {"loan_amnt": applicant["loan_amnt"].iloc[0] * 1.20},
        "Income +10%": {"person_income": applicant["person_income"].iloc[0] * 1.10},
        "Income +20%": {"person_income": applicant["person_income"].iloc[0] * 1.20},
        "Interest Rate +1%": {"loan_int_rate": applicant["loan_int_rate"].iloc[0] + 1},
        "Interest Rate +2%": {"loan_int_rate": applicant["loan_int_rate"].iloc[0] + 2},
        "Employment -1 year": {
            "person_emp_length": max(0, applicant["person_emp_length"].iloc[0] - 1)
        },
        "Employment -2 years": {
            "person_emp_length": max(0, applicant["person_emp_length"].iloc[0] - 2)
        },
    }

    counterfactual_results = []

    for scenario_name, changes in counterfactual_scenarios.items():
        scenario = applicant.copy()
        for feature, value in changes.items():
            scenario[feature] = value

        counterfactual_results.append(
            scenario_result(scenario_name, probability_of(scenario), current_probability)
        )

    # -----------------------------------------------------
    # FINANCIAL STRESS TESTING (scenario definitions unchanged)
    # -----------------------------------------------------

    stress_scenarios = {
        "Income -10%": {"person_income": applicant["person_income"].iloc[0] * 0.90},
        "Income -20%": {"person_income": applicant["person_income"].iloc[0] * 0.80},
        "Interest Rate +2%": {"loan_int_rate": applicant["loan_int_rate"].iloc[0] + 2},
        "Loan Amount +10%": {"loan_amnt": applicant["loan_amnt"].iloc[0] * 1.10},
    }

    stress_results = []

    for scenario_name, changes in stress_scenarios.items():
        stressed = applicant.copy()
        for feature, value in changes.items():
            stressed[feature] = value

        stress_results.append(
            scenario_result(scenario_name, probability_of(stressed), current_probability)
        )

    # -----------------------------------------------------
    # COMBINED STRESS
    # -----------------------------------------------------

    combined_stress = applicant.copy()
    combined_stress["person_income"] = combined_stress["person_income"] * 0.80
    combined_stress["loan_int_rate"] = combined_stress["loan_int_rate"] + 2
    combined_stress["loan_amnt"] = combined_stress["loan_amnt"] * 1.10

    combined_probability = probability_of(combined_stress)
    combined = scenario_result("Combined Stress", combined_probability, current_probability)

    # -----------------------------------------------------
    # IMPORTANT SCENARIOS
    # -----------------------------------------------------

    highest_counterfactual = max(counterfactual_results, key=lambda x: x["risk_change"])
    lowest_counterfactual = min(counterfactual_results, key=lambda x: x["risk_change"])
    highest_stress = max(stress_results, key=lambda x: x["risk_change"])

    return {
        "prediction": {
            "probability": round(float(current_probability * 100), 2),
            "threshold": round(float(threshold * 100), 2),
            "prediction": prediction,
            "risk_level": risk_level,
        },
        "counterfactual": {
            "scenarios": counterfactual_results,
            "highest_risk_increase": highest_counterfactual,
            "largest_risk_reduction": lowest_counterfactual,
        },
        "stress_testing": {
            "scenarios": stress_results,
            "highest_stress": highest_stress,
            "combined_stress": {
                "risk": combined["risk"],
                "risk_change": combined["risk_change"],
            },
        },
        "decision_summary": {
            "current_risk": round(float(current_probability * 100), 2),
            "risk_level": risk_level,
            "decision": "High Risk" if prediction == 1 else "Low Risk",
            "highest_risk_increasing_scenario": highest_counterfactual["scenario"],
            "highest_risk_increase": highest_counterfactual["risk_change"],
            "largest_risk_reducing_scenario": lowest_counterfactual["scenario"],
            "highest_individual_stress": highest_stress["scenario"],
            "combined_stress_risk": combined["risk"],
            "combined_stress_change": combined["risk_change"],
        },
    }


# =========================================================
# FRONTEND (served at /app/) — mount AFTER all API routes
# =========================================================

FRONTEND_DIR = Path(__file__).resolve().parent.parent / "frontend"
if FRONTEND_DIR.is_dir():
    app.mount("/app", StaticFiles(directory=FRONTEND_DIR, html=True), name="frontend")