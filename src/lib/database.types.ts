
export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]

export type Database = {
  
  "graphql_public": {
          Tables: {
            [_ in never]: never
          }
          Views: {
            [_ in never]: never
          }
          Functions: {
            "graphql":
{ Args: { "extensions"?: Json,"operationName"?: string,"query"?: string,"variables"?: Json }; Returns: Json
                           }
          }
          Enums: {
            [_ in never]: never
          }
          CompositeTypes: {
            [_ in never]: never
          }
        },"public": {
          Tables: {
            "advice_logs": {
                  Row: {
                    "advice_summary": string,"advice_text": string,"created_at": string,"generated_at": string,"guest_id": string | null,"id": string,"model_version": string | null,"triggered_by": Database["public"]['Enums']["triggered_by"],"user_id": string | null,"video_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "advice_summary": string,"advice_text": string,"created_at"?: string,"generated_at": string,"guest_id"?: string | null,"id"?: string,"model_version"?: string | null,"triggered_by": Database["public"]['Enums']["triggered_by"],"user_id"?: string | null,"video_id": string
                  }
                  Update: {
                    "advice_summary"?: string,"advice_text"?: string,"created_at"?: string,"generated_at"?: string,"guest_id"?: string | null,"id"?: string,"model_version"?: string | null,"triggered_by"?: Database["public"]['Enums']["triggered_by"],"user_id"?: string | null,"video_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "advice_logs_user_id_fkey"
      columns: ["user_id"]
isOneToOne: false
      referencedRelation: "users"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "advice_logs_video_id_fkey"
      columns: ["video_id"]
isOneToOne: false
      referencedRelation: "videos"
      referencedColumns: ["id"]
    }
                  ]
                },"api_usage_logs": {
                  Row: {
                    "created_at": string,"duration_ms": number | null,"endpoint": string,"estimated_cost_usd": number | null,"guest_id": string | null,"id": string,"input_tokens": number | null,"ip_hash": string | null,"model": string | null,"output_tokens": number | null,"service": string,"succeeded": boolean,"units": number | null,"user_id": string | null,"video_id": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"duration_ms"?: number | null,"endpoint": string,"estimated_cost_usd"?: number | null,"guest_id"?: string | null,"id"?: string,"input_tokens"?: number | null,"ip_hash"?: string | null,"model"?: string | null,"output_tokens"?: number | null,"service": string,"succeeded": boolean,"units"?: number | null,"user_id"?: string | null,"video_id"?: string | null
                  }
                  Update: {
                    "created_at"?: string,"duration_ms"?: number | null,"endpoint"?: string,"estimated_cost_usd"?: number | null,"guest_id"?: string | null,"id"?: string,"input_tokens"?: number | null,"ip_hash"?: string | null,"model"?: string | null,"output_tokens"?: number | null,"service"?: string,"succeeded"?: boolean,"units"?: number | null,"user_id"?: string | null,"video_id"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "api_usage_logs_user_id_fkey"
      columns: ["user_id"]
isOneToOne: false
      referencedRelation: "users"
      referencedColumns: ["id"]
    }
                  ]
                },"comment_analysis": {
                  Row: {
                    "analyzed_at": string,"comment_id": string,"created_at": string,"embedding": string | null,"group_id": string | null,"id": string,"is_latest": boolean,"labels": (string)[],"ng_words": (string)[] | null,"primary_category": Database["public"]['Enums']["primary_category"],"review_required": boolean | null,"score": number | null,"topic": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "analyzed_at": string,"comment_id": string,"created_at"?: string,"embedding"?: string | null,"group_id"?: string | null,"id"?: string,"is_latest"?: boolean,"labels"?: (string)[],"ng_words"?: (string)[] | null,"primary_category": Database["public"]['Enums']["primary_category"],"review_required"?: boolean | null,"score"?: number | null,"topic"?: string | null
                  }
                  Update: {
                    "analyzed_at"?: string,"comment_id"?: string,"created_at"?: string,"embedding"?: string | null,"group_id"?: string | null,"id"?: string,"is_latest"?: boolean,"labels"?: (string)[],"ng_words"?: (string)[] | null,"primary_category"?: Database["public"]['Enums']["primary_category"],"review_required"?: boolean | null,"score"?: number | null,"topic"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "comment_analysis_comment_id_fkey"
      columns: ["comment_id"]
isOneToOne: false
      referencedRelation: "comments"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "comment_analysis_group_id_fkey"
      columns: ["group_id"]
isOneToOne: false
      referencedRelation: "comment_groups"
      referencedColumns: ["id"]
    }
                  ]
                },"comment_groups": {
                  Row: {
                    "comment_count": number,"created_at": string,"group_type": Database["public"]['Enums']["group_type"],"id": string,"representative_embedding": string,"representative_text": string,"updated_at": string,"video_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "comment_count": number,"created_at"?: string,"group_type": Database["public"]['Enums']["group_type"],"id"?: string,"representative_embedding": string,"representative_text": string,"updated_at"?: string,"video_id": string
                  }
                  Update: {
                    "comment_count"?: number,"created_at"?: string,"group_type"?: Database["public"]['Enums']["group_type"],"id"?: string,"representative_embedding"?: string,"representative_text"?: string,"updated_at"?: string,"video_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "comment_groups_video_id_fkey"
      columns: ["video_id"]
isOneToOne: false
      referencedRelation: "videos"
      referencedColumns: ["id"]
    }
                  ]
                },"comments": {
                  Row: {
                    "author": string | null,"body_hash": string | null,"comment_text": string,"created_at": string,"external_comment_id": string | null,"id": string,"like_count": number | null,"parent_comment_id": string | null,"posted_at": string | null,"reply_count": number | null,"updated_at": string,"video_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "author"?: string | null,"body_hash"?: string | null,"comment_text": string,"created_at"?: string,"external_comment_id"?: string | null,"id"?: string,"like_count"?: number | null,"parent_comment_id"?: string | null,"posted_at"?: string | null,"reply_count"?: number | null,"updated_at"?: string,"video_id": string
                  }
                  Update: {
                    "author"?: string | null,"body_hash"?: string | null,"comment_text"?: string,"created_at"?: string,"external_comment_id"?: string | null,"id"?: string,"like_count"?: number | null,"parent_comment_id"?: string | null,"posted_at"?: string | null,"reply_count"?: number | null,"updated_at"?: string,"video_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "comments_parent_comment_id_fkey"
      columns: ["parent_comment_id"]
isOneToOne: false
      referencedRelation: "comments"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "comments_video_id_fkey"
      columns: ["video_id"]
isOneToOne: false
      referencedRelation: "videos"
      referencedColumns: ["id"]
    }
                  ]
                },"ng_words": {
                  Row: {
                    "category": string | null,"created_at": string,"id": string,"normalized": string | null,"severity": number | null,"word": string
                  }
                  ComputedFields: never
                  Insert: {
                    "category"?: string | null,"created_at"?: string,"id"?: string,"normalized"?: string | null,"severity"?: number | null,"word": string
                  }
                  Update: {
                    "category"?: string | null,"created_at"?: string,"id"?: string,"normalized"?: string | null,"severity"?: number | null,"word"?: string
                  }
                  Relationships: [
                    
                  ]
                },"sources": {
                  Row: {
                    "api_notes": string | null,"base_url": string | null,"created_at": string,"id": string,"name": string
                  }
                  ComputedFields: never
                  Insert: {
                    "api_notes"?: string | null,"base_url"?: string | null,"created_at"?: string,"id"?: string,"name": string
                  }
                  Update: {
                    "api_notes"?: string | null,"base_url"?: string | null,"created_at"?: string,"id"?: string,"name"?: string
                  }
                  Relationships: [
                    
                  ]
                },"users": {
                  Row: {
                    "created_at": string,"id": string,"name": string | null,"role": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"id": string,"name"?: string | null,"role"?: string
                  }
                  Update: {
                    "created_at"?: string,"id"?: string,"name"?: string | null,"role"?: string
                  }
                  Relationships: [
                    
                  ]
                },"videos": {
                  Row: {
                    "analysis_started_at": string,"analysis_status": Database["public"]['Enums']["analysis_status"],"created_at": string,"fetch_status": Database["public"]['Enums']["fetch_status"],"guest_id": string | null,"id": string,"published_at": string | null,"source_id": string,"thumbnail_url": string | null,"title": string,"user_id": string | null,"video_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "analysis_started_at"?: string,"analysis_status"?: Database["public"]['Enums']["analysis_status"],"created_at"?: string,"fetch_status"?: Database["public"]['Enums']["fetch_status"],"guest_id"?: string | null,"id"?: string,"published_at"?: string | null,"source_id": string,"thumbnail_url"?: string | null,"title": string,"user_id"?: string | null,"video_id": string
                  }
                  Update: {
                    "analysis_started_at"?: string,"analysis_status"?: Database["public"]['Enums']["analysis_status"],"created_at"?: string,"fetch_status"?: Database["public"]['Enums']["fetch_status"],"guest_id"?: string | null,"id"?: string,"published_at"?: string | null,"source_id"?: string,"thumbnail_url"?: string | null,"title"?: string,"user_id"?: string | null,"video_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "videos_source_id_fkey"
      columns: ["source_id"]
isOneToOne: false
      referencedRelation: "sources"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "videos_user_id_fkey"
      columns: ["user_id"]
isOneToOne: false
      referencedRelation: "users"
      referencedColumns: ["id"]
    }
                  ]
                }
          }
          Views: {
            [_ in never]: never
          }
          Functions: {
            "comments_to_analyze":
{ Args: { "p_limit": number,"p_video_id": string }; Returns: {
              "author": string | null,
"body_hash": string | null,
"comment_text": string,
"created_at": string,
"external_comment_id": string | null,
"id": string,
"like_count": number | null,
"parent_comment_id": string | null,
"posted_at": string | null,
"reply_count": number | null,
"updated_at": string,
"video_id": string
            }[]
                          SetofOptions: {
        from: "*"
        to: "comments"
        isOneToOne: false
        isSetofReturn: true
      } },
"comments_to_group":
{ Args: { "p_limit": number,"p_video_id": string }; Returns: {
              "analysis_id": string,
"comment_text": string,
"labels": (string)[],
"primary_category": Database["public"]['Enums']["primary_category"],
"topic": string | null
            }[]
                           },
"refresh_group_counts":
{ Args: { "p_video_id": string }; Returns: undefined
                           },
"video_analysis_summary":
{ Args: { "p_video_id": string }; Returns: Json
                           },
"video_rankings":
{ Args: { "p_limit": number,"p_video_id": string }; Returns: Json
                           }
          }
          Enums: {
            "analysis_status": "analyzing"|"done"|"failed","fetch_status": "fetching"|"done"|"failed","group_type": "feedback_request"|"question","primary_category": "question"|"feedback"|"praise"|"negative_opinion"|"harmful"|"spam"|"other","triggered_by": "system"|"user"
          }
          CompositeTypes: {
            [_ in never]: never
          }
        }
}

type DatabaseWithoutInternals = Omit<Database, '__InternalSupabase'>

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
  ? (DefaultSchema["Tables"] & DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
      Row: infer R
    }
    ? R
    : never
  : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
  ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
      Insert: infer I
    }
    ? I
    : never
  : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
  ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
      Update: infer U
    }
    ? U
    : never
  : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never
> = DefaultSchemaEnumNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
  ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
  : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never
> = PublicCompositeTypeNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
  ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
  : never

export const Constants = {
  "graphql_public": {
          Enums: {
            
          }
        },"public": {
          Enums: {
            "analysis_status": ["analyzing", "done", "failed"],"fetch_status": ["fetching", "done", "failed"],"group_type": ["feedback_request", "question"],"primary_category": ["question", "feedback", "praise", "negative_opinion", "harmful", "spam", "other"],"triggered_by": ["system", "user"]
          }
        }
} as const
