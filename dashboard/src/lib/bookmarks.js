import { supabase } from "./supabase.js";

// Bookmarks flag problems for a retry. problem_name is the problem's slug,
// matching problems.problem_name.

export async function fetchBookmarks(userId) {
  const { data, error } = await supabase
    .from("bookmarks")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return data ?? [];
}

export async function addBookmark({ userId, problemName, difficulty, tags = [], note = "" }) {
  // Insert, or do nothing if it's already bookmarked (the table has no update
  // policy, so a merging upsert would be rejected).
  const { error } = await supabase.from("bookmarks").upsert(
    { user_id: userId, problem_name: problemName, difficulty, tags, note },
    { onConflict: "user_id,problem_name", ignoreDuplicates: true }
  );
  if (error) throw error;
}

export async function removeBookmark({ userId, problemName }) {
  const { error } = await supabase
    .from("bookmarks")
    .delete()
    .eq("user_id", userId)
    .eq("problem_name", problemName);
  if (error) throw error;
}
