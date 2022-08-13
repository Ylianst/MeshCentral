# This is for running mkdocs locally on windows only. 
# Make sure you change directory to your docs folder before starting this process
# Use the "Run Selection" in VSCode to run the code blocks as-needed

#Activate python
cd docs
python -m venv env
.\env\Scripts\activate 

#Install requirements first time only
python -m pip install --upgrade pip #only 1st time or use periodically to update pip modules
pip install pytest #only 1st time
pip install mkdocs #only 1st time
pip install mkdocs-material #only 1st time

#Run mkdocs and look at changes as you make them
start-process http://localhost:8010 #Opens Browser
mkdocs serve

#Stop python
deactivate