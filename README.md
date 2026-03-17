# MLMI16 HCI Project

This project is used for Cambridge MLMI16 Advanced HCI — a web-based typing experiment with suggestion acceptance, configurable delays, and data visualization.

## Installation

### 1. Clone the repository

```bash
git clone https://github.com/BoqiaoZ00/MLMI16_HCI_Project.git
cd MLMI16_HCI_Project
```

### 2. Set up Conda environment

```bash
conda create -n mlmi16_hci python=3.11
conda activate mlmi16_hci
```

### 3. Install dependencies

```bash
pip install -r requirements.txt
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
