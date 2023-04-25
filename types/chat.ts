import { Document } from 'langchain/document';

export type Message = {
  type: 'apiMessage' | 'userMessage';
  message: string;
  isStreaming?: boolean;
  sourceDocs?: Document[];
};
export type History = {
  role: Role;
  content: string;
};

export type Role = 'assistant' | 'user';
