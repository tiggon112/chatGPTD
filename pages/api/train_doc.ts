import type { NextApiRequest, NextApiResponse } from 'next';
import {
  DirectoryLoader,
  PDFLoader,
  TextLoader,
  DocxLoader,
} from 'langchain/document_loaders';
import { RecursiveCharacterTextSplitter } from 'langchain/text_splitter';
import { OpenAIEmbeddings } from 'langchain/embeddings/openai';
import { PineconeClient } from '@pinecone-database/pinecone';
import { PineconeStore } from 'langchain/vectorstores';
import path from 'path';

const PINECONE_INDEX_NAME = process.env.PINECONE_INDEX_NAME;

if (!process.env.PINECONE_ENVIRONMENT || !process.env.PINECONE_API_KEY) {
  throw new Error('Pinecone environment or api key vars missing');
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  let status = 200,
    resultBody = {
      status: 'ok',
      message: 'Files were uploaded successfully',
    };

  try {
    let rawDocs = [];

    const extension = req.body.slice(
      (Math.max(0, req.body.lastIndexOf('.')) || Infinity) + 1,
    );

    const targetPath = path.join(process.cwd(), `/uploads/`);

    switch (extension) {
      case 'docx' || 'doc':
        const DocLoader = new DocxLoader(targetPath + req.body);
        rawDocs = await DocLoader.load();
        break;
      case 'txt':
        const TxtLoader = new TextLoader(targetPath + req.body);
        rawDocs = await TxtLoader.load();
        break;
      default:
        const PdfLoader = new PDFLoader(targetPath + req.body);
        rawDocs = await PdfLoader.load();
        break;
    }

    /* Split text into chunks */
    const textSplitter = new RecursiveCharacterTextSplitter({
      chunkSize: 1000,
      chunkOverlap: 0,
    });

    const docs = await textSplitter.splitDocuments(rawDocs);
    console.log('Split docs', docs);
    console.log('Creating vector store...');

    /* Create and Store the embeddings in to vectorStore */
    const embeddings = new OpenAIEmbeddings({
      openAIApiKey: process.env.OPENAI_KEY,
    });

    const pinecone = new PineconeClient();
    await pinecone.init({
      environment: process.env.PINECONE_ENVIRONMENT ?? '', //this is in the dashboard
      apiKey: process.env.PINECONE_API_KEY ?? '',
    });

    const index = pinecone.Index(PINECONE_INDEX_NAME ?? ''); //change to your own index name
    index.delete1({
      deleteAll: true,
      namespace: process.env.PINECONE_NAME_SPACE,
    });

    // embed the documents
    await PineconeStore.fromDocuments(docs, embeddings, {
      pineconeIndex: index,
      namespace: process.env.PINECONE_NAME_SPACE,
      textKey: 'text',
    });
    res.status(status).json(resultBody);
  } catch (error) {
    console.log('error1', error);
    // throw new Error('Failed to ingest your data');
  } finally {
    res.write('[DONE]');
    res.end();
  }
}
