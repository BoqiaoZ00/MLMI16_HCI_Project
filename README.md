# MLMI16 HCI Project

This project is used for Cambridge MLMI16 Advanced HCI — a web-based typing experiment with suggestion acceptance, configurable delays, and data visualization.

## Installation

### 1. Clone the repository

```bash
git clone https://github.com/BoqiaoZ00/MLMI16_HCI_Project.git
cd MLMI16_HCI_Project
```

### 2. Set up Conda environment

Create a **fresh** environment (avoids conflicts with other packages like wfdb):

```bash
conda create -n mlmi16_hci python=3.11
conda activate mlmi16_hci
```

Python 3.10 or 3.11 works.

### 3. Install dependencies

With the conda environment activated, use `python -m pip` so packages install into the conda env (not system Python):

```bash
python -m pip install -r requirements.txt
```

## Running the experiment

1. Start the Flask server:

```bash
python app.py
```

2. Open Chrome and go to:

```
http://localhost:8000/
```

## Data visualization

To visualize recorded experiment data:

```bash
# Single participant
python Data_Visualization/visualize.py "Data_Recorded/<participant_id>"

# All participants (aggregated boxplots)
python Data_Visualization/visualize.py "Data_Recorded"
```

Outputs are saved to `Data_Visualization/output/`.

## Troubleshooting

- **ModuleNotFoundError (e.g. flask)**: Use `python -m pip install -r requirements.txt` instead of `pip install` so packages install into the conda env’s Python.
- **Dependency conflicts (wfdb, scipy)**: Use a fresh conda environment as above.
