# venti

Simple Vue SSR framework.

### Usage

```vue
<template>
  <div class="example">{{ msg }}</div>
</template>
<script>
import { useData } from 'ventijs'
import { computed } from 'vue'

export function loader() {
  return {
    msg: 'Hello world!',
  }
}

export default {
  setup() {
    const data = useData()
    const msg = computed(() => data.value.msg)

    return {
      msg,
    }
  },
}
</script>
<style>
.example {
  color: red;
}
</style>
```