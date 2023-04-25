import type { NextApiRequest, NextApiResponse } from 'next';
import { OpenAIEmbeddings } from 'langchain/embeddings/openai';

import { PineconeStore } from 'langchain/vectorstores/pinecone';

import { OpenAI, OpenAIChat } from 'langchain/llms/openai';

import { Configuration, OpenAIApi } from 'openai';
import { PineconeClient } from '@pinecone-database/pinecone';
import {
  AIChatMessage,
  HumanChatMessage,
  SystemChatMessage,
} from 'langchain/schema';
import { History } from '@/types/chat';
import { LLMChain, loadQAChain } from 'langchain/chains';
import { PromptTemplate } from 'langchain/prompts';
import { CallbackManager } from 'langchain/callbacks';

const system_message = '';

//Prompt for when no references found, no embeddings passed
const CONDENSE_PROMPT = PromptTemplate.fromTemplate(`
  {chat_history}
  Human: {question}
  Assistant:""`);

//Prompt for when there are references found (embedding)
const SYSTEM_TEMPLATE = PromptTemplate.fromTemplate(
  `
  {chat_history}
    Question: {question}
    =========
    {context}
    =========
    Answer in Markdown:`,
);

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  const {
    question,
    history,
    filter,
  }: {
    question: string;
    history: History[][];
    filter: any;
  } = req.body;

  if (!question) {
    return res.status(400).json({
      message: 'No question in the request',
    });
  }
  // res.pipe
  // OpenAI recommends replacing newlines with spaces for best results
  const sanitizedQuestion = question.trim().replaceAll('\n', ' ');
  const filter_string: Array<string> = [];
  let full_history: any = null;
  //extract filter string from filter(Object format)
  Object.values(filter).forEach((value: any) => {
    if (value[0]) filter_string.push(value[0].name);
  });

  // Initialize e
  const client = new PineconeClient();
  await client.init({
    apiKey: process.env.PINECONE_API_KEY ?? '',
    environment: process.env.PINECONE_ENVIRONMENT ?? '',
  });
  // client.projectName = 'default';

  const pineconeIndex = client.Index(process.env.PINECONE_INDEX_NAME ?? '');
  const vectorStore = await PineconeStore.fromExistingIndex(
    new OpenAIEmbeddings({
      openAIApiKey: process.env.OPENAI_API_KEY,
    }),
    {
      pineconeIndex,
      namespace: process.env.PINECONE_NAME_SPACE,
    },
  );

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
  });

  const sendData = (data: string) => {
    res.write(`data: ${data}\n\n`);
  };

  // Initialize OpenAI
  const configuration = new Configuration({
    apiKey: process.env.OPENAI_API_KEY,
  });
  const openai = new OpenAIApi(configuration);

  try {
    const openModel = new OpenAIChat({
      temperature: 0,
      modelName: 'gpt-3.5-turbo',
      frequencyPenalty: 0,
      presencePenalty: 0,
      openAIApiKey: process.env.OPENAI_API_KEY,
      streaming: true,
      callbackManager: CallbackManager.fromHandlers({
        async handleLLMNewToken(token: string) {
          sendData(JSON.stringify({ data: token }));
        },
      }),
    });

    const queryList: any = {
      Interest: [],
      Canton: [],
      Commune: [],
    };

    //Generate metadata filter query
    Object.entries(filter).forEach(([key, obj]: [string, any]) => {
      obj.forEach((item: { name: string; id: number }) => {
        queryList[key].push(item.name);
      });
    });

    //generating metadata filter query

    const score_data: [any, number][] =
      await vectorStore.similaritySearchWithScore(sanitizedQuestion, 10);

    //filt only score > 0.85
    let output = score_data
      .filter((item) => item[1] > 0.5)
      .map((item) => item[0]);

    //New Response Dataformat discussed with Elin

    //if there are no similarities, clear output and also make normal call for ChatGPT to answer the generically question without any vector
    console.log(output.length);

    if (output.length === 0) {
      let history_ai: any[] = history.map(([item]: History[]) => {
        if (item.role === 'user') return new HumanChatMessage(item.content);
        else return new AIChatMessage(item.content);
      });
      full_history = [new SystemChatMessage(system_message)].concat(history_ai);

      //question generator
      const questionGenerator = new LLMChain({
        llm: new OpenAIChat({
          modelName: 'gpt-3.5-turbo',
          temperature: 0.1,
          presencePenalty: 0,
          frequencyPenalty: 0,
          openAIApiKey: process.env.OPENAI_API_KEY,
          streaming: true,
          callbackManager: CallbackManager.fromHandlers({
            async handleLLMNewToken(token: string) {
              sendData(JSON.stringify({ data: token }));
            },
          }),
        }),
        prompt: CONDENSE_PROMPT,
      });

      //generate answer with chathisory
      const result = await questionGenerator.call({
        question: sanitizedQuestion,
        chat_history: full_history || [],
      });

      sendData(JSON.stringify({ data: result.text }));
    } else {
      //Method specific to the question I want to ask to chatGPT. In this case I pass question, chatHistory and vectorBase with high rating
      // It will return the answer in same format as output.

      const chain_vector = loadQAChain(openModel, {
        type: 'stuff',
        prompt: SYSTEM_TEMPLATE,
      });

      //generator answer from document array
      const result_vectors = await chain_vector.call({
        input_documents: output,
        question: sanitizedQuestion,
        chat_history: [],
      });

      console.log('reducechain---', result_vectors);

      // sendData(JSON.stringify({ data: result_vectors.text }));
      sendData(JSON.stringify({ data: result_vectors.text }));

      sendData(JSON.stringify({ sourceDocs: output }));
    }
  } catch (error) {
    console.log('error', error);
  } finally {
    sendData('[DONE]');
    res.end();
  }
}
