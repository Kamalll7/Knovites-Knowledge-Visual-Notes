import type * as React from 'react'
import { Popover as RadixPopover } from 'radix-ui'
import { cn } from '@/ui/lib/utils'

export const Popover = RadixPopover.Root
export const PopoverTrigger = RadixPopover.Trigger
export const PopoverClose = RadixPopover.Close

export function PopoverContent({
  className,
  align = 'start',
  sideOffset = 6,
  ...props
}: React.ComponentProps<typeof RadixPopover.Content>) {
  return (
    <RadixPopover.Portal>
      <RadixPopover.Content
        align={align}
        sideOffset={sideOffset}
        className={cn(
          'z-50 rounded-lg border border-border bg-card p-3 text-card-foreground shadow-lg outline-none',
          className,
        )}
        {...props}
      />
    </RadixPopover.Portal>
  )
}
