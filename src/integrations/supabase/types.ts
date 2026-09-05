export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      audit_logs: {
        Row: {
          action: string
          actor_id: string | null
          created_at: string
          entity: string
          entity_id: string | null
          id: string
          payload: Json
        }
        Insert: {
          action: string
          actor_id?: string | null
          created_at?: string
          entity: string
          entity_id?: string | null
          id?: string
          payload?: Json
        }
        Update: {
          action?: string
          actor_id?: string | null
          created_at?: string
          entity?: string
          entity_id?: string | null
          id?: string
          payload?: Json
        }
        Relationships: []
      }
      categories: {
        Row: {
          created_at: string
          created_by: string | null
          description: string | null
          hero_media_id: string | null
          id: string
          name: string
          position: number
          published_at: string | null
          seo_description: string | null
          seo_title: string | null
          slug: string
          status: Database["public"]["Enums"]["content_status"]
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          description?: string | null
          hero_media_id?: string | null
          id?: string
          name: string
          position?: number
          published_at?: string | null
          seo_description?: string | null
          seo_title?: string | null
          slug: string
          status?: Database["public"]["Enums"]["content_status"]
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          description?: string | null
          hero_media_id?: string | null
          id?: string
          name?: string
          position?: number
          published_at?: string | null
          seo_description?: string | null
          seo_title?: string | null
          slug?: string
          status?: Database["public"]["Enums"]["content_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "categories_hero_media_id_fkey"
            columns: ["hero_media_id"]
            isOneToOne: false
            referencedRelation: "media_assets"
            referencedColumns: ["id"]
          },
        ]
      }
      collections: {
        Row: {
          created_at: string
          created_by: string | null
          description: string | null
          hero_media_id: string | null
          id: string
          name: string
          position: number
          published_at: string | null
          seo_description: string | null
          seo_title: string | null
          slug: string
          status: Database["public"]["Enums"]["content_status"]
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          description?: string | null
          hero_media_id?: string | null
          id?: string
          name: string
          position?: number
          published_at?: string | null
          seo_description?: string | null
          seo_title?: string | null
          slug: string
          status?: Database["public"]["Enums"]["content_status"]
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          description?: string | null
          hero_media_id?: string | null
          id?: string
          name?: string
          position?: number
          published_at?: string | null
          seo_description?: string | null
          seo_title?: string | null
          slug?: string
          status?: Database["public"]["Enums"]["content_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "collections_hero_media_id_fkey"
            columns: ["hero_media_id"]
            isOneToOne: false
            referencedRelation: "media_assets"
            referencedColumns: ["id"]
          },
        ]
      }
      contact_requests: {
        Row: {
          contact_channel: string
          contact_value: string
          created_at: string
          entry_url: string | null
          full_name: string
          id: string
          marketing_consent: boolean
          message: string
          privacy_version: string
          protocol: string
          source: string | null
          status: Database["public"]["Enums"]["request_status"]
          subject: string
          updated_at: string
          utm: Json
        }
        Insert: {
          contact_channel: string
          contact_value: string
          created_at?: string
          entry_url?: string | null
          full_name: string
          id?: string
          marketing_consent?: boolean
          message: string
          privacy_version: string
          protocol?: string
          source?: string | null
          status?: Database["public"]["Enums"]["request_status"]
          subject: string
          updated_at?: string
          utm?: Json
        }
        Update: {
          contact_channel?: string
          contact_value?: string
          created_at?: string
          entry_url?: string | null
          full_name?: string
          id?: string
          marketing_consent?: boolean
          message?: string
          privacy_version?: string
          protocol?: string
          source?: string | null
          status?: Database["public"]["Enums"]["request_status"]
          subject?: string
          updated_at?: string
          utm?: Json
        }
        Relationships: []
      }
      lead_events: {
        Row: {
          actor_id: string | null
          created_at: string
          event_type: string
          id: string
          lead_id: string
          note: string | null
        }
        Insert: {
          actor_id?: string | null
          created_at?: string
          event_type: string
          id?: string
          lead_id: string
          note?: string | null
        }
        Update: {
          actor_id?: string | null
          created_at?: string
          event_type?: string
          id?: string
          lead_id?: string
          note?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "lead_events_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
        ]
      }
      leads: {
        Row: {
          assigned_to: string | null
          audience: string | null
          availability: string | null
          city: string
          created_at: string
          entry_url: string | null
          experience: string | null
          financial_goal: string | null
          full_name: string
          id: string
          marketing_consent: boolean
          motivation: string | null
          no_number: boolean
          postal_code: string | null
          privacy_version: string
          protocol: string
          source: string | null
          status: Database["public"]["Enums"]["lead_status"]
          street: string | null
          street_number: string | null
          uf: string
          updated_at: string
          utm: Json
          whatsapp: string
        }
        Insert: {
          assigned_to?: string | null
          audience?: string | null
          availability?: string | null
          city: string
          created_at?: string
          entry_url?: string | null
          experience?: string | null
          financial_goal?: string | null
          full_name: string
          id?: string
          marketing_consent?: boolean
          motivation?: string | null
          no_number?: boolean
          postal_code?: string | null
          privacy_version: string
          protocol?: string
          source?: string | null
          status?: Database["public"]["Enums"]["lead_status"]
          street?: string | null
          street_number?: string | null
          uf: string
          updated_at?: string
          utm?: Json
          whatsapp: string
        }
        Update: {
          assigned_to?: string | null
          audience?: string | null
          availability?: string | null
          city?: string
          created_at?: string
          entry_url?: string | null
          experience?: string | null
          financial_goal?: string | null
          full_name?: string
          id?: string
          marketing_consent?: boolean
          motivation?: string | null
          no_number?: boolean
          postal_code?: string | null
          privacy_version?: string
          protocol?: string
          source?: string | null
          status?: Database["public"]["Enums"]["lead_status"]
          street?: string | null
          street_number?: string | null
          uf?: string
          updated_at?: string
          utm?: Json
          whatsapp?: string
        }
        Relationships: []
      }
      media_assets: {
        Row: {
          alt: string
          byte_size: number | null
          content_type: string | null
          created_at: string
          created_by: string | null
          height: number | null
          id: string
          is_archived: boolean
          storage_path: string | null
          updated_at: string
          url: string
          width: number | null
        }
        Insert: {
          alt?: string
          byte_size?: number | null
          content_type?: string | null
          created_at?: string
          created_by?: string | null
          height?: number | null
          id?: string
          is_archived?: boolean
          storage_path?: string | null
          updated_at?: string
          url: string
          width?: number | null
        }
        Update: {
          alt?: string
          byte_size?: number | null
          content_type?: string | null
          created_at?: string
          created_by?: string | null
          height?: number | null
          id?: string
          is_archived?: boolean
          storage_path?: string | null
          updated_at?: string
          url?: string
          width?: number | null
        }
        Relationships: []
      }
      page_versions: {
        Row: {
          blocks: Json
          created_at: string
          created_by: string | null
          id: string
          note: string | null
          page_id: string
          title: string
          version: number
        }
        Insert: {
          blocks?: Json
          created_at?: string
          created_by?: string | null
          id?: string
          note?: string | null
          page_id: string
          title: string
          version: number
        }
        Update: {
          blocks?: Json
          created_at?: string
          created_by?: string | null
          id?: string
          note?: string | null
          page_id?: string
          title?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "page_versions_page_id_fkey"
            columns: ["page_id"]
            isOneToOne: false
            referencedRelation: "pages"
            referencedColumns: ["id"]
          },
        ]
      }
      pages: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          published_at: string | null
          published_version: number | null
          seo_description: string | null
          seo_title: string | null
          slug: string
          status: Database["public"]["Enums"]["content_status"]
          title: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          published_at?: string | null
          published_version?: number | null
          seo_description?: string | null
          seo_title?: string | null
          slug: string
          status?: Database["public"]["Enums"]["content_status"]
          title: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          published_at?: string | null
          published_version?: number | null
          seo_description?: string | null
          seo_title?: string | null
          slug?: string
          status?: Database["public"]["Enums"]["content_status"]
          title?: string
          updated_at?: string
        }
        Relationships: []
      }
      product_media: {
        Row: {
          created_at: string
          id: string
          media_id: string
          position: number
          product_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          media_id: string
          position?: number
          product_id: string
        }
        Update: {
          created_at?: string
          id?: string
          media_id?: string
          position?: number
          product_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "product_media_media_id_fkey"
            columns: ["media_id"]
            isOneToOne: false
            referencedRelation: "media_assets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_media_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_media_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "public_products"
            referencedColumns: ["id"]
          },
        ]
      }
      product_variants: {
        Row: {
          color: string | null
          created_at: string
          id: string
          is_active: boolean
          label: string
          position: number
          price_cents: number | null
          product_id: string
          size: string | null
          sku: string | null
          updated_at: string
        }
        Insert: {
          color?: string | null
          created_at?: string
          id?: string
          is_active?: boolean
          label: string
          position?: number
          price_cents?: number | null
          product_id: string
          size?: string | null
          sku?: string | null
          updated_at?: string
        }
        Update: {
          color?: string | null
          created_at?: string
          id?: string
          is_active?: boolean
          label?: string
          position?: number
          price_cents?: number | null
          product_id?: string
          size?: string | null
          sku?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "product_variants_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_variants_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "public_products"
            referencedColumns: ["id"]
          },
        ]
      }
      products: {
        Row: {
          care_instructions: string | null
          category_id: string | null
          collection_id: string | null
          created_at: string
          created_by: string | null
          description: string | null
          id: string
          material: string | null
          measurements: string | null
          name: string
          plating: string | null
          position: number
          price_cents: number | null
          price_is_public: boolean
          published_at: string | null
          seo_description: string | null
          seo_title: string | null
          short_description: string | null
          slug: string
          status: Database["public"]["Enums"]["content_status"]
          updated_at: string
          warranty_text: string | null
          weight_grams: number | null
        }
        Insert: {
          care_instructions?: string | null
          category_id?: string | null
          collection_id?: string | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          material?: string | null
          measurements?: string | null
          name: string
          plating?: string | null
          position?: number
          price_cents?: number | null
          price_is_public?: boolean
          published_at?: string | null
          seo_description?: string | null
          seo_title?: string | null
          short_description?: string | null
          slug: string
          status?: Database["public"]["Enums"]["content_status"]
          updated_at?: string
          warranty_text?: string | null
          weight_grams?: number | null
        }
        Update: {
          care_instructions?: string | null
          category_id?: string | null
          collection_id?: string | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          material?: string | null
          measurements?: string | null
          name?: string
          plating?: string | null
          position?: number
          price_cents?: number | null
          price_is_public?: boolean
          published_at?: string | null
          seo_description?: string | null
          seo_title?: string | null
          short_description?: string | null
          slug?: string
          status?: Database["public"]["Enums"]["content_status"]
          updated_at?: string
          warranty_text?: string | null
          weight_grams?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "products_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "products_collection_id_fkey"
            columns: ["collection_id"]
            isOneToOne: false
            referencedRelation: "collections"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          created_at: string
          email: string | null
          full_name: string | null
          id: string
          is_active: boolean
          phone: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          email?: string | null
          full_name?: string | null
          id: string
          is_active?: boolean
          phone?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          email?: string | null
          full_name?: string | null
          id?: string
          is_active?: boolean
          phone?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      site_settings: {
        Row: {
          is_public: boolean
          key: string
          updated_at: string
          updated_by: string | null
          value: Json
        }
        Insert: {
          is_public?: boolean
          key: string
          updated_at?: string
          updated_by?: string | null
          value?: Json
        }
        Update: {
          is_public?: boolean
          key?: string
          updated_at?: string
          updated_by?: string | null
          value?: Json
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          created_at: string
          granted_by: string | null
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          granted_by?: string | null
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          granted_by?: string | null
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      public_product_variants: {
        Row: {
          color: string | null
          id: string | null
          label: string | null
          position: number | null
          price_cents: number | null
          product_id: string | null
          size: string | null
          sku: string | null
        }
        Relationships: [
          {
            foreignKeyName: "product_variants_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_variants_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "public_products"
            referencedColumns: ["id"]
          },
        ]
      }
      public_products: {
        Row: {
          care_instructions: string | null
          category_id: string | null
          collection_id: string | null
          description: string | null
          id: string | null
          material: string | null
          measurements: string | null
          name: string | null
          plating: string | null
          position: number | null
          price_cents: number | null
          price_is_public: boolean | null
          published_at: string | null
          seo_description: string | null
          seo_title: string | null
          short_description: string | null
          slug: string | null
          warranty_text: string | null
          weight_grams: number | null
        }
        Insert: {
          care_instructions?: string | null
          category_id?: string | null
          collection_id?: string | null
          description?: string | null
          id?: string | null
          material?: string | null
          measurements?: string | null
          name?: string | null
          plating?: string | null
          position?: number | null
          price_cents?: never
          price_is_public?: boolean | null
          published_at?: string | null
          seo_description?: string | null
          seo_title?: string | null
          short_description?: string | null
          slug?: string | null
          warranty_text?: string | null
          weight_grams?: number | null
        }
        Update: {
          care_instructions?: string | null
          category_id?: string | null
          collection_id?: string | null
          description?: string | null
          id?: string | null
          material?: string | null
          measurements?: string | null
          name?: string | null
          plating?: string | null
          position?: number | null
          price_cents?: never
          price_is_public?: boolean | null
          published_at?: string | null
          seo_description?: string | null
          seo_title?: string | null
          short_description?: string | null
          slug?: string | null
          warranty_text?: string | null
          weight_grams?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "products_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "products_collection_id_fkey"
            columns: ["collection_id"]
            isOneToOne: false
            referencedRelation: "collections"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Functions: {
      can_manage_content: { Args: { _user_id: string }; Returns: boolean }
      can_manage_leads: { Args: { _user_id: string }; Returns: boolean }
      claim_master_role: { Args: never; Returns: boolean }
      ensure_profile: {
        Args: never
        Returns: {
          created_at: string
          email: string | null
          full_name: string | null
          id: string
          is_active: boolean
          phone: string | null
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "profiles"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      gen_protocol: { Args: { prefix: string }; Returns: string }
      grant_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      has_any_role: {
        Args: {
          _roles: Database["public"]["Enums"]["app_role"][]
          _user_id: string
        }
        Returns: boolean
      }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      is_staff: { Args: { _user_id: string }; Returns: boolean }
      master_exists: { Args: never; Returns: boolean }
      my_roles: {
        Args: never
        Returns: Database["public"]["Enums"]["app_role"][]
      }
      revoke_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      submit_contact_request: {
        Args: {
          p_contact_channel: string
          p_contact_value: string
          p_entry_url?: string
          p_full_name: string
          p_marketing_consent?: boolean
          p_message: string
          p_privacy_version?: string
          p_source?: string
          p_subject: string
          p_utm?: Json
        }
        Returns: string
      }
      submit_lead: {
        Args: {
          p_audience?: string
          p_availability?: string
          p_city: string
          p_entry_url?: string
          p_experience?: string
          p_financial_goal?: string
          p_full_name: string
          p_marketing_consent?: boolean
          p_motivation?: string
          p_no_number?: boolean
          p_postal_code?: string
          p_privacy_version?: string
          p_source?: string
          p_street?: string
          p_street_number?: string
          p_uf: string
          p_utm?: Json
          p_whatsapp: string
        }
        Returns: string
      }
    }
    Enums: {
      app_role:
        | "master"
        | "diretoria"
        | "marketing"
        | "suporte"
        | "financeiro"
        | "cobranca"
        | "estoque"
        | "montagem"
        | "qualidade"
        | "representante"
        | "consultora"
      content_status: "rascunho" | "revisao" | "publicado" | "arquivado"
      lead_status:
        | "novo"
        | "em_analise"
        | "qualificado"
        | "aprovado"
        | "recusado"
        | "arquivado"
      request_status: "novo" | "em_atendimento" | "respondido" | "arquivado"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
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
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      app_role: [
        "master",
        "diretoria",
        "marketing",
        "suporte",
        "financeiro",
        "cobranca",
        "estoque",
        "montagem",
        "qualidade",
        "representante",
        "consultora",
      ],
      content_status: ["rascunho", "revisao", "publicado", "arquivado"],
      lead_status: [
        "novo",
        "em_analise",
        "qualificado",
        "aprovado",
        "recusado",
        "arquivado",
      ],
      request_status: ["novo", "em_atendimento", "respondido", "arquivado"],
    },
  },
} as const
