import React from 'react';
import axios from 'axios';
import Image from 'next/image';
import { Message, History } from '../types/chat';
import { useSelector } from 'react-redux';
import ReactMarkdown from 'react-markdown';
import styles from '@/styles/Home.module.css';
import { Document } from 'langchain/document';
import LoadingDots from '../components/ui/LoadingDots';
import { multiselectFilterProps } from '../utils/interface';
import { UploadOutlined } from '@ant-design/icons';
import { fetchEventSource } from '@microsoft/fetch-event-source';
import { FilterBar } from '../components/ui/SearchFilter/FilterBar';
import { useRef, useState, useEffect, useMemo, useCallback } from 'react';
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '../components/ui/accordion';
import {
  Button,
  Modal,
  Upload,
  Input,
  Space,
  message,
  Spin,
  Row,
  Col,
} from 'antd';
import pdfjsLib from 'pdfjs-dist';

export default function Home() {
  const filter = useSelector((state: { filter: any }) => state.filter);
  const [query, setQuery] = useState<string>('');
  const [loading, setLoading] = useState<boolean>(false);
  const [sourceDocs, setSourceDocs] = useState<Document[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [messageApi, contextHolder] = message.useMessage();
  const [isLoading, setIsLoading] = useState(false);
  const [isWebSiteLinksDisable, setIsWebSiteLinksDisable] = useState(false);
  const [isUploadDisable, setIsUploadDisable] = useState(false);
  const [websiteLinksField, SetWebSiteLinksField] = useState('');

  const [filterOptions, setFilterOption] = useState<multiselectFilterProps>({
    Interest: [],
    Canton: [],
    Commune: [],
  });
  const [messageState, setMessageState] = useState<{
    messages: Message[];
    pending?: string;
    history: History[];
    pendingSourceDocs?: any[];
  }>({
    messages: [],
    history: [],
    pendingSourceDocs: [],
  });

  const { messages, pending, history, pendingSourceDocs } = messageState;

  const messageListRef = useRef<HTMLDivElement>(null);
  const textAreaRef = useRef<HTMLTextAreaElement>(null);

  //handle form submission
  async function handleSubmit(e: any) {
    e.preventDefault();

    setError(null);

    if (!query) {
      alert('Please input a question');
      return;
    }

    const question = query.trim();
    setMessageState((state) => ({
      ...state,
      messages: [
        ...state.messages,
        {
          type: 'userMessage',
          message: question,
        },
      ],
      pending: undefined,
    }));

    setLoading(true);
    setQuery('');
    setMessageState((state) => ({ ...state, pending: '' }));

    const ctrl = new AbortController();

    try {
      await fetchEventSource('/api/chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          question,
          history,
          filter,
        }),
        signal: ctrl.signal,
        onmessage: (event) => {
          console.log('----', event.data);
          if (event.data === '[DONE]') {
            setMessageState((state: any) => ({
              // history: [...state.history, [question, state.pending ?? '']],
              history: [
                ...state.history,
                [{ role: 'user', content: question }],
                [{ role: 'assistant', content: state.pending ?? '' }],
              ],
              messages: [
                ...state.messages,
                {
                  type: 'apiMessage',
                  message: state.pending ?? '',
                  sourceDocs: state.pendingSourceDocs,
                },
              ],
              pending: undefined,
              pendingSourceDocs: undefined,
            }));
            setLoading(false);
            ctrl.abort();
          } else {
            const data = JSON.parse(event.data);
            if (data.sourceDocs) {
              setMessageState((state) => ({
                ...state,
                pendingSourceDocs: data.sourceDocs,
              }));
            } else {
              setMessageState((state) => ({
                ...state,
                pending: (state.pending ?? '') + data.data,
              }));
            }
          }
        },
      });
    } catch (error) {
      setLoading(false);
      setError('An error occurred while fetching the data. Please try again.');
      console.log('error', error);
    }
  }

  //prevent empty submissions
  const handleEnter = useCallback(
    (e: any) => {
      if (e.key === 'Enter' && query) {
        handleSubmit(e);
      } else if (e.key == 'Enter') {
        e.preventDefault();
      }
    },
    [query],
  );

  const chatMessages = useMemo(() => {
    return [
      ...messages,
      ...(pending
        ? [
            {
              type: 'apiMessage',
              message: pending,
              sourceDocs: pendingSourceDocs,
            },
          ]
        : []),
    ];
  }, [messages, pending, pendingSourceDocs]);

  //scroll to bottom of chat
  useEffect(() => {
    if (messageListRef.current) {
      messageListRef.current.scrollTop = messageListRef.current.scrollHeight;
    }
  }, [chatMessages]);

  const uploadChange = (event: any) => {
    setUploadFile(event.target.files[0]);
    setIsWebSiteLinksDisable(true);
  };

  const showModal = () => {
    setIsModalOpen(true);
  };
  const handleOk = () => {
    setIsModalOpen(false);
  };
  const handleCancel = () => {
    setIsModalOpen(false);
  };

  const fileUpload = async () => {
    setIsLoading(true);
    const formData = new FormData();
    formData.append('file', uploadFile as File);
    const fileName = uploadFile?.name;

    const response = await fetch('/api/upload-file', {
      method: 'POST',
      body: formData,
    });

    if (response.ok) {
      const resp = await fetch('/api/train_doc', {
        method: 'POST',
        body: fileName,
      });

      setIsModalOpen(false);
      setIsLoading(false);
      if (resp.ok) {
        messageApi.open({
          type: 'success',
          content: 'Successful for Uploading and Embedding.',
        });
      }
    } else {
      messageApi.open({
        type: 'error',
        content: 'Failure for Uploading or Embedding.',
      });
    }
  };

  const onWebSiteLinks = async () => {
    setIsLoading(true);

    const res = await fetch('/api/train_links', {
      method: 'POST',
      body: websiteLinksField,
    });

    setIsModalOpen(false);
    setIsLoading(false);
    if (res.ok) {
      messageApi.open({
        type: 'success',
        content: 'Successful for Uploading and Embedding.',
      });
    } else {
      messageApi.open({
        type: 'error',
        content: 'Failure for Uploading or Embedding.',
      });
    }
  };

  return (
    <>
      {contextHolder}
      <Modal
        title="Document or Website links!"
        open={isModalOpen}
        onOk={handleOk}
        onCancel={handleCancel}
        width={400}
        okButtonProps={{ style: { display: 'none' } }}
        cancelButtonProps={{ style: { display: 'none' } }}
      >
        <Spin spinning={isLoading}>
          <Space direction="vertical" size="middle">
            <Space.Compact>
              <Row style={{ width: '100%' }} justify="space-between">
                <Col sm={16} xs={12}>
                  <Upload>
                    <input
                      type="file"
                      onChange={uploadChange}
                      disabled={isUploadDisable}
                    />
                  </Upload>
                </Col>
                <Col sm={8} xs={8}>
                  <Button
                    style={{ width: '100%' }}
                    icon={<UploadOutlined />}
                    onClick={fileUpload}
                    disabled={isUploadDisable}
                  >
                    Upload
                  </Button>
                </Col>
              </Row>
            </Space.Compact>
            <Space.Compact style={{ width: '100%' }}>
              <Row style={{ width: '100%' }} justify="space-between">
                <Col sm={15} xs={12}>
                  <Input
                    placeholder="Please type the website links."
                    disabled={isWebSiteLinksDisable}
                    onChange={(e) => {
                      SetWebSiteLinksField(e.target.value);
                      if (e.target.value == '') {
                        setIsUploadDisable(false);
                      } else {
                        setIsUploadDisable(true);
                      }
                    }}
                  />
                </Col>
                <Col sm={8} xs={8}>
                  <Button
                    style={{ width: '100%' }}
                    disabled={isWebSiteLinksDisable}
                    onClick={onWebSiteLinks}
                  >
                    Submit
                  </Button>
                </Col>
              </Row>
            </Space.Compact>
          </Space>
        </Spin>
      </Modal>

      <header className="container sticky top-0 z-40 bg-white"></header>
      <h3 className="border-white text-2xl leading-[1.1] tracking-tighter text-center">
        <Button
          onClick={showModal}
          style={{ marginBottom: '15px', marginTop: '11px' }}
        >
          Start Embedding from Document or Website links
        </Button>{' '}
      </h3>
      {/* <div id="searchfilter-region">
        <FilterBar filterOptions={filterOptions} />
      </div> */}
      <div style={{ margin: '15px' }}>
        <div className={styles.cloud}>
          <div ref={messageListRef} className={styles.messagelist}>
            {chatMessages.map((message, index) => {
              let icon;
              let className;
              if (message.type === 'apiMessage') {
                icon = (
                  <Image
                    src="/bot-image.png"
                    alt="AI"
                    width="35"
                    height="35"
                    className={styles.boticon}
                    priority
                  />
                );
                className = styles.apimessage;
              } else {
                icon = (
                  <Image
                    src="/usericon.png"
                    alt="Me"
                    width="35"
                    height="35"
                    className={styles.usericon}
                    priority
                  />
                );
                // The latest message sent by the user will be animated while waiting for a response
                className =
                  loading && index === chatMessages.length - 1
                    ? styles.usermessagewaiting
                    : styles.usermessage;
              }
              return (
                <div key={index + 1}>
                  <div key={`chatMessage-${index}`} className={className}>
                    {icon}
                    <div className={styles.markdownanswer}>
                      <ReactMarkdown linkTarget="_blank">
                        {message.message}
                      </ReactMarkdown>
                    </div>
                  </div>
                  {message.sourceDocs && (
                    <div className="p-5">
                      <Accordion type="single" collapsible className="flex-col">
                        {message.sourceDocs.map((doc, index) => {
                          return (
                            <div key={`messageSourceDocs-${index}`}>
                              <AccordionItem value={`item-${index}`}>
                                <AccordionTrigger>
                                  <h3>Source {index + 1}</h3>
                                </AccordionTrigger>
                                <AccordionContent>
                                  <ReactMarkdown linkTarget="_blank">
                                    {doc.pageContent}
                                  </ReactMarkdown>
                                  <p className="mt-2">
                                    <b>Source:</b>{' '}
                                    {doc.metadata.source.startsWith('http') ? (
                                      <a
                                        href={
                                          doc.metadata.page
                                            ? doc.metadata.source +
                                              '#page=' +
                                              doc.metadata.page
                                            : doc.metadata.source
                                        }
                                        target="_blank"
                                      >
                                        {doc.metadata.Title
                                          ? doc.metadata.Title
                                          : doc.metadata.source}
                                      </a>
                                    ) : (
                                      doc.metadata.source
                                    )}
                                  </p>
                                </AccordionContent>
                              </AccordionItem>
                            </div>
                          );
                        })}
                      </Accordion>
                    </div>
                  )}
                </div>
              );
            })}
            {sourceDocs.length > 0 && (
              <div className="p-5">
                <Accordion type="single" collapsible className="flex-col">
                  {sourceDocs.map((doc, index) => (
                    <div key={`sourceDocs-${index}`}>
                      <AccordionItem value={`item-${index}`}>
                        <AccordionTrigger>
                          <h3>Source {index + 1}</h3>
                        </AccordionTrigger>
                        <AccordionContent>
                          <ReactMarkdown linkTarget="_blank">
                            {doc.pageContent}
                          </ReactMarkdown>
                        </AccordionContent>
                      </AccordionItem>
                    </div>
                  ))}
                </Accordion>
              </div>
            )}
          </div>
        </div>
        <div className={styles.center}>
          <div className={styles.cloudform}>
            <form onSubmit={handleSubmit}>
              <textarea
                disabled={loading}
                onKeyDown={handleEnter}
                ref={textAreaRef}
                autoFocus={false}
                rows={1}
                maxLength={512}
                id="userInput"
                name="userInput"
                placeholder={loading ? 'Waiting for response...' : ''}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                className={styles.textarea}
              />
              <button
                type="submit"
                disabled={loading}
                className={styles.generatebutton}
              >
                {loading ? (
                  <div className={styles.loadingwheel}>
                    <LoadingDots color="#000" />
                  </div>
                ) : (
                  // Send icon SVG in input field
                  <svg
                    viewBox="0 0 20 20"
                    className={styles.svgicon}
                    xmlns="http://www.w3.org/2000/svg"
                  >
                    <path d="M10.894 2.553a1 1 0 00-1.788 0l-7 14a1 1 0 001.169 1.409l5-1.429A1 1 0 009 15.571V11a1 1 0 112 0v4.571a1 1 0 00.725.962l5 1.428a1 1 0 001.17-1.408l-7-14z"></path>
                  </svg>
                )}
              </button>
            </form>
          </div>
        </div>
        {error && (
          <div className="border border-red-400 rounded-md p-4">
            <p className="text-red-500">{error}</p>
          </div>
        )}
      </div>
    </>
  );
}
