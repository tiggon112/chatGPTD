import pdb
from googleapiclient.discovery import build
import hashlib
from google.oauth2 import service_account
from urllib.request import Request, urlopen
from io import BytesIO
from datetime import datetime
import pinecone
import requests
import os
from langchain.document_loaders import OnlinePDFLoader
from langchain.document_loaders import UnstructuredURLLoader
from langchain.document_loaders import UnstructuredFileLoader
from langchain.text_splitter import RecursiveCharacterTextSplitter
from langchain.document_loaders import WebBaseLoader
from langchain.vectorstores import Pinecone
from langchain.embeddings.openai import OpenAIEmbeddings
from langchain.document_loaders import PyPDFLoader
from langchain.docstore.document import Document
from dotenv import load_dotenv
import json
from more_itertools import locate

load_dotenv()
m = hashlib.md5()


SHEET_ID = os.environ["SHEET_ID"]
SCOPES = ["https://www.googleapis.com/auth/spreadsheets"]
SERVICE_ACCOUNT_FILE = 'client.json'
PINECONE_INDEX_NAME = os.environ["PINECONE_INDEX_NAME"]
PINECONE_NAME_SPACE = os.environ["PINECONE_NAME_SPACE"]
RANGE = os.environ["RANGE"]

creds = service_account.Credentials.from_service_account_file(
    SERVICE_ACCOUNT_FILE, scopes=SCOPES)
service = build('sheets', 'v4', credentials=creds)

# Contants for reading google sheet
index_canton = 0
index_commune = 1
index_url = 14
index_title = 11
index_organization = 16
url_read_status = 15
presuccessUrl = []
errurl = []
interestoption = []

# Read doc infos from google sheet
def ReadUrls():
    global interestoption

    result = service.spreadsheets().values().get(
        spreadsheetId=SHEET_ID, range=RANGE).execute()

    interest = service.spreadsheets().values().get(
        spreadsheetId=SHEET_ID, range=os.environ["RANGE_INTEREST"]).execute()

    interestoption = interest.get('values', [])[0]

    values = result.get('values', [])

    #Extract URLs to read(not marked with "X")
    temp = []
    for i, field in enumerate(values):
        if len(field) > index_url:
            if (field[index_url].startswith('http://') or field[index_url].startswith('https://')) and ((field[index_canton] != '') or (field[index_commune] != '')):
                if len(field) > url_read_status:
                    if field[url_read_status] != "X":
                        temp.append(field)
                        presuccessUrl.append(i+2)
                else:
                    temp.append(field)
                    presuccessUrl.append(i+2)

    return temp

#seperate pdf, html from urls
def SyncUrls(urls):
    print("Loading from urls....")
    mark = []
    successUrl = presuccessUrl.copy()
    #Get headers using request.get() to check if url is html or doc
    for i, url in enumerate(urls):
        text = ""
        r = requests.get(url[index_url])
        if ('application/pdf' in r.headers["content-type"]):
            print("PDF")
            text = PDF2Text(url, i)
        elif 'text/html' in r.headers["content-type"]:
            print("HTML")
            text = HTML2Text(url, i)
        if text != "":
            Learning(text, url)

    errurl.reverse()
    #pop reading failed url from url list
    for err in errurl:
        presuccessUrl.pop(err)

    
    if len(presuccessUrl):
        i = 2
        j = 0
        while i <= presuccessUrl[len(presuccessUrl)-1]:
            if i == presuccessUrl[j]:
                j += 1
                mark.append("X")
            else:
                mark.append(None)
            i += 1

        print(mark)
        write(mark)

    print("Loading finished")

#Extract text from remote pdf
def PDF2Text(url, pos):
    data = ""
    try:
        Canton = []
        Commune = []

        loader = PyPDFLoader(url[index_url])
        data = loader.load()

        #extract Canton from sheet
        if url[index_canton]:
            if url[index_canton] == "- intercantonale":
                Canton.append("ALL")    
            Canton.append(url[index_canton])

        #extract Commune from sheet
        if url[index_commune]:
            if url[index_commune] == "- intercommunale":
                Commune.append("ALL")    
            Commune.append(url[index_commune])

        #extract Interest from sheet
        indices = list(locate(url, lambda x: x == '1'))
        interest = []
        for index in indices:
            interest.append(interestoption[index - 2])

        #insert doc infor to metadata(source url, filter keyword, title)
        for meta_item in data:
            meta_item.metadata.update({
                'source': url[index_url],
                'Canton': Canton or [],
                'Commune': Commune or [],
                'Interest': interest or [],
                'Title': url[index_title] or "",
                'organization':url[index_organization] or ""
            })
    #logging error with time stamp amd url
    except Exception as e:
        #store reading error url to arrray for max "X"
        errurl.append(pos)
        sttime = datetime.now().strftime('%Y-%m-%d_%H:%M:%S - ')

        with open('UnReadableFile.txt', 'a') as f:
            f.write(sttime + url[index_url] + str(e) + '\n')
        pass

    finally:
        return data

#Extract text from webpage
def HTML2Text(url, pos):
    data = ""
    try:
        Canton = []
        Commune = []

        loader = WebBaseLoader(url[index_url])
        data = loader.load()
        
        print("data---",data[slice(30)])

        #extract Canton from sheet
        if url[index_canton]:
            if url[index_canton] == "- intercantonale":
                Canton.append("ALL")
            Canton.append(url[index_canton])
    
        #extract Commune from sheet
        if url[index_commune]:
            if url[index_commune] == "- intercommunale":
                Commune.append("ALL") 
            Commune.append(url[index_commune])

        #generate Area of interest from sheet
        indices = list(locate(url, lambda x: x == '1'))
        interest = []
        for index in indices:
            interest.append(interestoption[index - 2])

        #insert filter doc info(title, source url, filter keyword) to metadata
        data[0].metadata = {
            'source': url[index_url],
            'Canton': Canton or [],
            'Commune': Commune or [],
            'Interest': interest or [],
            'Title': url[index_title] or "",
            'organization':url[index_organization] or ""
        }
    #logging error with time stamp amd url
    except Exception as e:
        #store reading error url to arrray for max "X"
        errurl.append(pos)
        sttime = datetime.now().strftime('%Y-%m-%d_%H:%M:%S - ')

        with open('UnReadableFile.txt', 'a') as f:
            f.write(sttime + url[index_url] + str(e) + '\n')
        pass

    finally:
        return data

#Split text as chunk size and store to Pinecone
def Learning(data, url):
    try:
        text_splitter = RecursiveCharacterTextSplitter(
            chunk_size=1000, chunk_overlap=200)

        docs = text_splitter.split_documents(data)
        #OpenAI Embedding
        embeddings = OpenAIEmbeddings(
            openai_api_key=os.environ["OPENAI_API_KEY"])

        index = pinecone.Index(index_name=PINECONE_INDEX_NAME)
        #Pinecone init
        pinecone.init(
            api_key=os.environ["PINECONE_API_KEY"],
            environment=os.environ["PINECONE_ENVIRONMENT"]
        )

        ids = [] 
        texts = []
        metadatas = []

        #generate vector ids from url, metadatas, texts
        for i, doc in enumerate(docs):
            m.update(url[index_url].encode('utf-8'))
            uid = m.hexdigest()[:12]
            ids.append(f"{uid}-{i}")
            texts.append(doc.page_content)
            metadatas.append(doc.metadata)
        #store to pinecone
        Pinecone.from_texts(texts=texts, ids=ids, embedding=embeddings, metadatas=metadatas,
                            index_name=PINECONE_INDEX_NAME, namespace=PINECONE_NAME_SPACE)
      
        print("Stored One Doc")
    except Exception as e:
        #logging errors on UnReadableFile.txt
        sttime = datetime.now().strftime('%Y-%m-%d_%H:%M:%S - ')
        with open('UnReadableFile.txt', 'a') as f:
            f.write(sttime + url[index_url] + str(e) + '\n')
        pass

#If Read the Urls mentioned in google sheet, Mark "X"
def write(mark):
    request = service.spreadsheets().values().update(spreadsheetId=SHEET_ID, range='Master!P1', valueInputOption="USER_ENTERED", body={
        "majorDimension": "COLUMNS",
        "values": [ mark ]
    })
    response = request.execute()

#Read PDF files stored on local
def SyncLocal():
    entries = os.listdir('../docs/')

    for entry in entries:
        path = '../docs/' + entry
        try:
            loader = PyPDFLoader(path)
            rawTxt = loader.load()
            Learning(rawTxt, path)
        except Exception as e:
            sttime = datetime.now().strftime('%Y-%m-%d_%H:%M:%S - ')
            with open('UnReadableFile.txt', 'a') as f:
                f.write(sttime + path + str(e) + '\n')


if __name__ == '__main__':
    urls = ReadUrls()
    SyncUrls(urls)
    # SyncLocal()
