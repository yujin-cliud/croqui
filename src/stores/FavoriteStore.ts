import { create } from 'zustand';

type FavoriteState = {
  favoriteIds: string[];
  isLoading: boolean;
  setFavoriteIds: (favoriteIds: string[]) => void;
  setLoading: (isLoading: boolean) => void;
};

export const useFavoriteStore = create<FavoriteState>((set) => ({
  favoriteIds: [],
  isLoading: false,
  setFavoriteIds: (favoriteIds) => set({ favoriteIds }),
  setLoading: (isLoading) => set({ isLoading }),
}));
