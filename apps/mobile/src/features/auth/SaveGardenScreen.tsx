import { upgradeBody } from '@xeno/shared';
import { router } from 'expo-router';
import { ArrowLeft, Lock, Mail, User } from 'lucide-react-native';
import { useRef, useState } from 'react';
import { View, type TextInput } from 'react-native';
import { useTheme } from '@/design';
import { ApiError, errorMessage } from '@/lib/api';
import { validate, type FieldErrors } from '@/lib/forms';
import { useSession } from '@/lib/session';
import { Banner, Button, IconButton, Screen, Text, TextField, toast } from '@/ui';
import { useSaveGarden } from './hooks';

type Field = 'name' | 'email' | 'password';

/**
 * "Save your garden": turns this phone's guest account into an email account (same devices), so
 * the garden can be opened on another phone or after reinstalling. Entirely optional.
 */
export function SaveGardenScreen() {
  const t = useTheme();
  const save = useSaveGarden();
  const current = useSession((s) => s.user);
  const [name, setName] = useState(current?.guest ? '' : (current?.name ?? ''));
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [errors, setErrors] = useState<FieldErrors<Field>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const emailRef = useRef<TextInput>(null);
  const passwordRef = useRef<TextInput>(null);

  const submit = () => {
    setFormError(null);
    const v = validate(upgradeBody, { name, email, password });
    if (!v.ok) return setErrors(v.errors);
    setErrors({});
    save.mutate(v.data, {
      onSuccess: () => {
        toast.success('Garden saved', 'Sign in with this email on any phone.');
        router.back();
      },
      onError: (err) => {
        if (err instanceof ApiError && err.code === 'CONFLICT') {
          setErrors({ email: 'An account with this email already exists' });
        } else {
          setFormError(errorMessage(err));
        }
      },
    });
  };

  return (
    <Screen
      keyboard
      headerLeft={<IconButton icon={ArrowLeft} accessibilityLabel="Back" onPress={() => router.back()} />}
    >
      <View style={{ gap: t.space.xs, marginBottom: t.space.xxl }}>
        <Text variant="title" accessibilityRole="header">
          Save your garden
        </Text>
        <Text variant="body" tone="textSecondary">
          Add an email so you can open your garden on another phone, or after reinstalling the app. Your devices
          stay exactly as they are.
        </Text>
      </View>

      <View style={{ gap: t.space.lg }}>
        {formError ? <Banner tone="danger" title={formError} /> : null}
        <TextField
          label="Your name"
          icon={User}
          value={name}
          onChangeText={setName}
          error={errors.name}
          autoComplete="name"
          textContentType="name"
          autoCapitalize="words"
          returnKeyType="next"
          onSubmitEditing={() => emailRef.current?.focus()}
          testID="sign-up-name"
        />
        <TextField
          ref={emailRef}
          label="Email"
          icon={Mail}
          value={email}
          onChangeText={setEmail}
          error={errors.email}
          autoCapitalize="none"
          keyboardType="email-address"
          autoComplete="email"
          textContentType="emailAddress"
          returnKeyType="next"
          onSubmitEditing={() => passwordRef.current?.focus()}
          testID="sign-up-email"
        />
        <TextField
          ref={passwordRef}
          label="Password"
          icon={Lock}
          secure
          value={password}
          onChangeText={setPassword}
          error={errors.password}
          hint="At least 8 characters"
          autoComplete="new-password"
          textContentType="newPassword"
          returnKeyType="go"
          onSubmitEditing={submit}
          testID="sign-up-password"
        />
        <Button title="Save garden" onPress={submit} loading={save.isPending} fullWidth testID="sign-up-submit" />
      </View>
    </Screen>
  );
}
