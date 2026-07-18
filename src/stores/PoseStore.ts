import { create } from 'zustand';
import type { Pose, PoseIndexItem } from '../types/Pose';

type PoseState = {
  poses: PoseIndexItem[];
  currentPose: Pose | null;
  currentIndex: number;
  selectedTags: string[];
  filteredPoseIds: string[];
  preloadedPoseIds: string[];
  isLoading: boolean;
  error: string | null;
  setPoses: (poses: PoseIndexItem[]) => void;
  setCurrentPose: (pose: Pose | null, index: number) => void;
  setSelectedTags: (tags: string[]) => void;
  setFilteredPoseIds: (ids: string[]) => void;
  setPreloadedPoseIds: (ids: string[]) => void;
  setLoading: (isLoading: boolean) => void;
  setError: (error: string | null) => void;
};

export const usePoseStore = create<PoseState>((set) => ({
  poses: [],
  currentPose: null,
  currentIndex: 0,
  selectedTags: [],
  filteredPoseIds: [],
  preloadedPoseIds: [],
  isLoading: false,
  error: null,
  setPoses: (poses) => set({ poses }),
  setCurrentPose: (currentPose, currentIndex) => set({ currentPose, currentIndex }),
  setSelectedTags: (selectedTags) => set({ selectedTags }),
  setFilteredPoseIds: (filteredPoseIds) => set({ filteredPoseIds }),
  setPreloadedPoseIds: (preloadedPoseIds) => set({ preloadedPoseIds }),
  setLoading: (isLoading) => set({ isLoading }),
  setError: (error) => set({ error }),
}));
