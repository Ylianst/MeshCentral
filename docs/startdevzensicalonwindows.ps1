# This is for running Zensical locally on Windows only. 
# Make sure you change directory to your docs folder before starting this process
# Use the "Run Selection" in VSCode to run the code blocks as-needed

# Activate Python
cd docs
python -m venv env
.\env\Scripts\activate 

# Install requirements (obvs first time only!)
python -m pip install --upgrade pip # Usable periodically to update pip modules
pip install pytest
pip install zensical
pip install mkdocs-material
pip install mkdocs-print-site-plugin
pip install pymdown-extensions

# Run Zensical and look at changes as you make them
start-process http://localhost:8010 #Opens Browser
zensical serve

# Stop Python
deactivate