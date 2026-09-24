'use client';

// Panel menü API istemcisi (14 §6.3 Menü). Tüm yazmalardan sonra ['panel','menu'] sorgusu tazelenir.

import { useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';
import type {
  BulkPriceRequest,
  BulkPriceResponse,
  BulkPriceRevertResponse,
  CategoryCreateRequest,
  CategoryUpdateRequest,
  MenuImportResponse,
  OptionGroupCreateRequest,
  OptionGroupUpdateRequest,
  PanelCategory,
  PanelMenuResponse,
  PanelOptionGroup,
  PanelProduct,
  ProductCreateRequest,
  ProductUpdateRequest,
  ReorderRequest,
  SoldOutResponse,
  UploadResponse,
} from '@siparis/core/menu/contracts';
import { MENU_LIMITS, UPLOAD_CONTENT_TYPES } from '@siparis/core/menu/contracts';
import { apiFetch, useApiQuery } from '@/lib/api';

export const MENU_QUERY_KEY = ['panel', 'menu'] as const;

export function useMenuQuery() {
  return useApiQuery<PanelMenuResponse>(MENU_QUERY_KEY, '/panel/menu', { staleTime: 10_000 });
}

export const menuApi = {
  createCategory: (body: CategoryCreateRequest) => apiFetch<PanelCategory>('/panel/categories', { method: 'POST', body }),
  updateCategory: (id: string, body: CategoryUpdateRequest) => apiFetch<PanelCategory>(`/panel/categories/${id}`, { method: 'PATCH', body }),
  deleteCategory: (id: string) => apiFetch(`/panel/categories/${id}`, { method: 'DELETE' }),
  createProduct: (body: ProductCreateRequest) => apiFetch<PanelProduct>('/panel/products', { method: 'POST', body }),
  updateProduct: (id: string, body: ProductUpdateRequest) => apiFetch<PanelProduct>(`/panel/products/${id}`, { method: 'PATCH', body }),
  deleteProduct: (id: string) => apiFetch(`/panel/products/${id}`, { method: 'DELETE' }),
  setSoldOut: (id: string, soldOut: boolean) =>
    apiFetch<SoldOutResponse>(`/panel/products/${id}/sold-out`, { method: 'POST', body: { until: soldOut ? 'end_of_day' : null } }),
  createGroup: (body: OptionGroupCreateRequest) => apiFetch<PanelOptionGroup>('/panel/option-groups', { method: 'POST', body }),
  updateGroup: (id: string, body: OptionGroupUpdateRequest) => apiFetch<PanelOptionGroup>(`/panel/option-groups/${id}`, { method: 'PATCH', body }),
  deleteGroup: (id: string) => apiFetch(`/panel/option-groups/${id}`, { method: 'DELETE' }),
  reorder: (body: ReorderRequest) => apiFetch('/panel/menu/reorder', { method: 'POST', body }),
  bulkPrice: (body: BulkPriceRequest) => apiFetch<BulkPriceResponse>('/panel/menu/bulk-price', { method: 'POST', body }),
  revertBulkPrice: (batchId: string) => apiFetch<BulkPriceRevertResponse>(`/panel/menu/bulk-price/${batchId}/revert`, { method: 'POST', body: {} }),
  importCsv: (csv: string, preview: boolean) => apiFetch<MenuImportResponse>('/panel/menu/import.csv', { method: 'POST', body: { csv, preview } }),
  upload: (file: File) => {
    const fd = new FormData();
    fd.append('file', file, file.name);
    return apiFetch<UploadResponse>('/panel/uploads', { method: 'POST', body: fd });
  },
};

export const EXPORT_CSV_URL = '/api/v1/panel/menu/export.csv';

/** Yüklemeden önce istemci denetimi (sunucu da dosya imzasıyla doğrular). Hata metni ya da null. */
export function checkImageFile(file: File): string | null {
  if (!(UPLOAD_CONTENT_TYPES as readonly string[]).includes(file.type)) return 'Yalnız JPEG, PNG ya da WebP görsel yükleyebilirsiniz.';
  if (file.size > MENU_LIMITS.uploadMaxBytes) return 'Görsel en fazla 5 MB olabilir.';
  return null;
}

/** Menü sorgusunu tazeler. */
export function useInvalidateMenu() {
  const qc = useQueryClient();
  return useCallback(() => qc.invalidateQueries({ queryKey: MENU_QUERY_KEY }), [qc]);
}
