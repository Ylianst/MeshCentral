# This is for running mkdocs locally on windows only. 
# Make sure you change directory to your docs folder before starting this process

#Activate python
python -m venv env
.\env\Scripts\activate 

#Install requirements first time only
python -m pip install --upgrade pip #only 1st time
pip install pytest #only 1st time
pip install mkdocs #only 1st time
pip install mkdocs-material #only 1st time

#Run mkdocs and look at changes as you make them
mkdocs serve
start http://localhost:8010 #Opens Browser

#Stop python
deactivate