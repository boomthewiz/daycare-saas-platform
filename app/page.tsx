'use client'

import { useEffect } from 'react'
import { supabase } from '@/lib/supabase'

export default function Home() {
  useEffect(() => {
    const testConnection = async () => {
      const { data, error } = await supabase.from('daycares').select('*')
      console.log('DATA:', data)
      console.log('ERROR:', error)
    }

    testConnection()
  }, [])

  return <div className="p-10">Testing Supabase Connection</div>
}