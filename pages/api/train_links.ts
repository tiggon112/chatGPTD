import type { NextApiRequest, NextApiResponse } from 'next';
import { RecursiveCharacterTextSplitter } from 'langchain/text_splitter';
import { OpenAIEmbeddings } from 'langchain/embeddings/openai';
import { PineconeClient } from '@pinecone-database/pinecone';
import { PineconeStore } from 'langchain/vectorstores';
import { CheerioWebBaseLoader } from 'langchain/document_loaders/web/cheerio';
import { getDocument, GlobalWorkerOptions } from 'pdfjs-dist/legacy/build/pdf';
import { Document } from 'langchain/document';

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
    let rawDocs: Document[] = [];
    let text = '';

    const extension = req.body.split('.').pop().toLowerCase();
    if (
      extension === 'pdf' &&
      (req.body.startsWith('http://') || req.body.startsWith('https://'))
    ) {
      const pdfLoader = getDocument(req.body);
      const pdf = await pdfLoader.promise;
      let maxPages = pdf._pdfInfo.numPages;

      for (let i = 1; i <= maxPages; i++) {
        let page = await pdf.getPage(i);
        let pageContext = await page.getTextContent();
        text += pageContext.items
          .map((s: any) => {
            return s.str;
          })
          .join('');
      }

      const docs = new Document({
        pageContent: text,
        metadata: {
          source: req.body,
        },
      });
      rawDocs.push(docs);
    } else {
      const WebsiteLinksloader = new CheerioWebBaseLoader(req.body);
      rawDocs = await WebsiteLinksloader.load();
    }

    /* Split text into chunks */
    const textSplitter = new RecursiveCharacterTextSplitter({
      chunkSize: 1000,
      chunkOverlap: 0,
    });

    const docs = await textSplitter.splitDocuments(rawDocs);

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
