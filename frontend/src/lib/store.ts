import { create } from 'zustand';
import type { Hold } from './types';
export const useHold=create<{hold:Hold|null;setHold:(hold:Hold|null)=>void}>(set=>({hold:null,setHold:hold=>set({hold})}));
