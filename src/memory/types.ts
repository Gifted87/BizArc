export interface MemoryDocumentChunk {
  collection: string;
  documentId: string;
  title: string;
  chunkIndex: number;
  content: string;
  metadata?: Record<string, any>;
  embedding?: number[];
}

export interface MemorySearchResult {
  id: string;
  collection: string;
  documentId: string;
  title: string;
  chunkIndex: number;
  content: string;
  metadata: Record<string, any>;
  similarity: number;
}

export interface IngestDocumentInput {
  collection: string;
  documentId: string;
  title: string;
  content: string;
  metadata?: Record<string, any>;
  chunkSize?: number;
}
