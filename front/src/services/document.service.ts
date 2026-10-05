import apiClient from '@/config/api';
import type { KnowledgeDocument } from '@/config/types';

export const listDocuments = async (): Promise<KnowledgeDocument[]> => {
  const { data } = await apiClient.get<KnowledgeDocument[]>('/admin/documents');
  return data;
};

export const uploadDocument = async (file: File): Promise<KnowledgeDocument> => {
  const form = new FormData();
  form.append('file', file);

  const { data } = await apiClient.post<KnowledgeDocument>('/admin/documents', form, {
    headers: { 'Content-Type': 'multipart/form-data' },
    timeout: 60_000,
  });
  return data;
};

export const deleteDocument = async (id: string): Promise<void> => {
  await apiClient.delete(`/admin/documents/${id}`);
};