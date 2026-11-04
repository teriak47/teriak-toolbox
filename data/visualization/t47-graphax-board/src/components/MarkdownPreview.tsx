import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

// Loaded on demand (React.lazy): the Markdown parser is only needed in the preview tab
export default function MarkdownPreview({ content }: { content: string }) {
  return (
    <div className="markdown-preview">
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
    </div>
  );
}
