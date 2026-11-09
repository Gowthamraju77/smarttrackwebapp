# SmartTrack ML service

The package extracts movement features without raw coordinates in the model
vector, then optionally scores them with One-Class SVM and Isolation Forest.
The score is a reliability index, not a safety probability. Without a
trusted, evaluated, explicitly promoted real-data artifact, inference is
unavailable rather than fabricated.

Install the reviewed manifest with `python -m pip install -r requirements.txt`
in a dedicated environment. Launch the authenticated FastAPI adapter with
`uvicorn smarttrack_ml.service:app --host 0.0.0.0 --port 8000` after setting
`SMARTTRACK_ML_SHARED_SECRET`, `SMARTTRACK_MODEL_PATH`, and
`SMARTTRACK_MODEL_SHA256`. Training and promotion are separate operator
steps; synthetic fixtures are for tests only and can never be promoted.
